"""
RBAC permission strings used to target xstock alert recipients
(AlertRecipients(permission=...)). Declared as grants in plugin.yaml
rbac.grants — kept as constants here so task/service code and the manifest
never drift apart.
"""

ALERTS_STOCK = "xstock:alerts:stock"
ALERTS_CONTROLLED_SUBSTANCE = "xstock:alerts:controlled_substance"
