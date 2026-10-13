"""
AlertService — resolves recipients and dispatches xstock alerts (threshold
breaches, expiry warnings, controlled-substance variance overrides...)
through in-app (SSE) and email channels.

Delivery contract (verified against app/XPulses):
  - In-app/SSE: fire the generic notification events xpulse already listens
    for — "ext.notification.publish" (single user) / "ext.notification.broadcast"
    (whole tenant, channel f"tenant-{tenant_id}") — same pattern as
    xcompany's XCompanyEvents and xtasks' PulseNotifier. NOT an IPC call:
    xpulse has no "xpulse.notify" action (xtasks calls one that doesn't
    exist and silently swallows the failure — don't repeat that mistake).
  - Email: xpulse's real IPC action is "xpulse.email", payload
    {"to": [addresses], "subject": str, "template": html_body, "html_parser": True}.
    xpulse does NOT resolve user_id -> email itself — this service resolves
    addresses via xauth IPC first.

Recipient targeting: explicit user_ids, or every tenant member holding a
given role_id, or every tenant member holding a given permission (checked
one-by-one via xauth.has_permission — xauth has no bulk-permission-check
IPC action, so this is O(members) IPC calls; fine at tenant-membership
scale, revisit if that ever becomes a bottleneck).
"""
from __future__ import annotations


from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional
from xcore.sdk import get_logger
logger = get_logger("xstock.alerts")

CallPlugin = Callable[[str, str, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class AlertRecipients:
    """
    Exactly one targeting mode is expected:
      - user_ids: explicit list, bypasses tenant membership resolution.
      - role_id: every tenant member with this role.
      - permission: every tenant member holding this permission (checked via xauth).
      - none of the above: every active tenant member (broad — use deliberately).
    """

    user_ids: Optional[list[str]] = None
    role_id: Optional[str] = None
    permission: Optional[str] = None


@dataclass(frozen=True)
class AlertDispatchResult:
    recipients_resolved: int
    sent_in_app: int
    sent_email: int
    task_id: Optional[int] = None


class AlertService:
    def __init__(
        self,
        tenant_id: str,
        call_plugin: CallPlugin,
        events_bus: Optional[Any] = None,
    ) -> None:
        self.tenant_id = tenant_id
        self._call_plugin = call_plugin
        self._events = events_bus

    # ── Recipient resolution (via xauth IPC) ────────────────────

    async def _resolve_recipients(self, recipients: AlertRecipients) -> list[dict[str, Any]]:
        if recipients.user_ids:
            resolved = []
            for user_id in recipients.user_ids:
                # Contrairement aux branches role_id/permission (qui partent
                # de xauth.users.list.tenant, donc déjà scopées), cette
                # branche acceptait n'importe quel user_id sans vérifier son
                # appartenance au tenant courant — canal d'exfiltration vers
                # un tenant tiers (audit xstock Constat 2). xauth.tenant_access
                # vérifie l'appartenance directement, un appel IPC par user_id.
                try:
                    access = await self._call_plugin(
                        "auth", "xauth.tenant_access",
                        {"user_id": user_id, "tenant_id": self.tenant_id},
                    )
                except Exception as exc:
                    logger.warning("xauth.tenant_access(%s) failed: %s", user_id, exc)
                    continue
                if not (access or {}).get("has_access", False):
                    logger.warning(
                        "user_id=%s n'est pas membre du tenant %s — exclu des destinataires d'alerte",
                        user_id, self.tenant_id,
                    )
                    continue
                try:
                    result = await self._call_plugin("auth", "xauth.get_user", {"user_id": user_id})
                except Exception as exc:
                    logger.warning("xauth.get_user(%s) failed: %s", user_id, exc)
                    continue
                user = (result or {}).get("user")
                if user and user.get("is_active", True):
                    resolved.append({"user_id": user_id, "email": user.get("email")})
            return resolved

        try:
            result = await self._call_plugin(
                "auth", "xauth.users.list.tenant", {"tenant_id": self.tenant_id}
            )
        except Exception as exc:
            logger.warning("xauth.users.list.tenant(%s) failed: %s", self.tenant_id, exc)
            return []
        members = [
            {"user_id": u["id"], "email": u.get("email")}
            for u in (result or {}).get("users", [])
        ]

        if recipients.role_id:
            # xauth.users.list.tenant n'expose pas role_id : on interroge
            # l'action existante xauth.member.list_roles (par membre, scopée
            # au tenant courant) — O(membres) appels IPC, comme `permission`.
            matched = []
            for member in members:
                try:
                    res = await self._call_plugin(
                        "auth",
                        "xauth.member.list_roles",
                        {"tenant_id": self.tenant_id, "user_id": member["user_id"]},
                    )
                except Exception as exc:
                    logger.warning(
                        "xauth.member.list_roles(%s) failed: %s", member.get("user_id"), exc
                    )
                    continue
                if recipients.role_id in (res or {}).get("role_ids", []):
                    matched.append(member)
            return matched

        if recipients.permission:
            allowed = []
            for member in members:
                try:
                    check = await self._call_plugin(
                        "auth",
                        "xauth.has_permission",
                        {
                            "user_id": member["user_id"],
                            "tenant_id": self.tenant_id,
                            "permission": recipients.permission,
                        },
                    )
                except Exception as exc:
                    logger.warning("xauth.has_permission(%s) failed: %s", member.get("user_id"), exc)
                    continue
                if (check or {}).get("has_permission"):
                    allowed.append(member)
            return allowed

        return members

    # ── Dispatch ─────────────────────────────────────────────

    async def send(
        self,
        *,
        recipients: AlertRecipients,
        event_type: str,
        subject: str,
        text: str,
        in_app: bool = True,
        email: bool = True,
        create_task: bool = False,
        task_priority: str = "normal",
        task_category: Optional[str] = None,
        extra: Optional[dict[str, Any]] = None,
    ) -> AlertDispatchResult:
        extra = extra or {}
        targets = await self._resolve_recipients(recipients)
        if not targets:
            return AlertDispatchResult(recipients_resolved=0, sent_in_app=0, sent_email=0)

        sent_in_app = 0
        if in_app and self._events is not None:
            for target in targets:
                if not target.get("user_id"):
                    continue
                try:
                    await self._events.emit(
                        "ext.notification.publish",
                        {
                            "user_id": target["user_id"],
                            "channels": ["notification"],
                            "event_type": event_type,
                            "text": text,
                            "tenant_id": self.tenant_id,
                            **extra,
                        },
                        source="xstock",
                    )
                    sent_in_app += 1
                except Exception as exc:
                    logger.warning("in-app notify failed for %s: %s", target.get("user_id"), exc)

        sent_email = 0
        if email:
            addresses = sorted({t["email"] for t in targets if t.get("email")})
            if addresses:
                try:
                    await self._call_plugin(
                        "xpulse",
                        "xpulse.email",
                        {"to": addresses, "subject": subject, "template": text, "html_parser": True},
                    )
                    sent_email = len(addresses)
                except Exception as exc:
                    logger.warning("email notify failed for %s: %s", addresses, exc)

        task_id = None
        if create_task:
            user_ids = [t["user_id"] for t in targets if t.get("user_id")]
            if user_ids:
                try:
                    result = await self._call_plugin(
                        "xtasks",
                        "xtasks.create",
                        {
                            "tenant_id": self.tenant_id,
                            "title": subject,
                            "description": text,
                            "assignees": [{"user_id": uid} for uid in user_ids],
                            # xtasks n'a pas de notion d'acteur système dédiée
                            # (`assignor_id` est requis, non-vide) — même
                            # convention que xtasks._on_tenant_deleted pour
                            # une action déclenchée par un cron plutôt qu'un
                            # utilisateur humain.
                            "assignor_id": "system",
                            "priority": task_priority,
                            "category": task_category or event_type,
                            "related_module": "xstock",
                        },
                    )
                except Exception as exc:
                    logger.warning("xtasks.create failed for alert %s: %s", event_type, exc)
                else:
                    task = (result or {}).get("task") or {}
                    task_id = task.get("id")
                    if task_id is None:
                        logger.warning(
                            "xtasks.create returned no task for alert %s: %s", event_type, result
                        )

        return AlertDispatchResult(
            recipients_resolved=len(targets),
            sent_in_app=sent_in_app,
            sent_email=sent_email,
            task_id=task_id,
        )
