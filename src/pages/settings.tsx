import { Settings, Bell, RotateCcw } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AlertSubscription, StockSettings } from '../types'

const SETTINGS_API = '/api/xstock/settings'

const ALERT_LABELS: Record<string, string> = {
  stock_threshold: 'Seuil de stock',
  batch_expiry: 'Péremption de lot',
  consumption_anomaly: 'Anomalie de consommation',
  cold_chain_excursion: 'Excursion chaîne du froid',
  controlled_substance_variance: 'Écart stupéfiants',
  transfer_suggestion: 'Suggestion de transfert',
}

function useSettings() {
  return useQuery<StockSettings>({
    queryKey: ['stock:settings'],
    queryFn: () => fetch(`${SETTINGS_API}/`).then(r => r.json()),
  })
}

function useAlertSubscriptions() {
  return useQuery<AlertSubscription[]>({
    queryKey: ['stock:alert-subscriptions'],
    queryFn: () => fetch(`${SETTINGS_API}/alert-subscriptions`).then(r => r.json()),
  })
}

export function SettingsPage() {
  const { data: settings, isLoading: loadingSettings } = useSettings()
  const { data: subscriptions, isLoading: loadingAlerts } = useAlertSubscriptions()
  const qc = useQueryClient()

  const updateSettings = useMutation({
    mutationFn: (data: Partial<StockSettings>) =>
      fetch(`${SETTINGS_API}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock:settings'] }),
  })

  const resetAlert = useMutation({
    mutationFn: (alertType: string) => fetch(`${SETTINGS_API}/alert-subscriptions/${alertType}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock:alert-subscriptions'] }),
  })

  if (loadingSettings || loadingAlerts) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-module-stock/12 text-module-stock">
          <Settings size={20} />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Paramètres stock</h1>
          <p className="text-xs text-tertiary">Réapprovisionnement, péremption, anomalies, chaîne du froid</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-semibold text-foreground">Réapprovisionnement</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Délai fournisseur par défaut (jours)</label>
              <input
                type="number" min="0" step="0.5"
                className="input"
                defaultValue={settings?.defaultLeadTimeDays}
                onBlur={e => updateSettings.mutate({ defaultLeadTimeDays: +e.target.value })}
              />
            </div>
            <div>
              <label className="label">Niveau de service par défaut</label>
              <input
                type="number" min="0" max="1" step="0.01"
                className="input"
                defaultValue={settings?.defaultServiceLevel}
                onBlur={e => updateSettings.mutate({ defaultServiceLevel: +e.target.value })}
              />
              <p className="form-hint">Entre 0 et 1 — utilisé pour le calcul du stock de sécurité</p>
            </div>
            <div>
              <label className="label">Alerte péremption (jours avant)</label>
              <input
                type="number" min="0"
                className="input"
                defaultValue={settings?.expiryWarningDays}
                onBlur={e => updateSettings.mutate({ expiryWarningDays: +e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-semibold text-foreground">Détection & chaîne du froid</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Seuil d'anomalie (z-score)</label>
              <input
                type="number" min="0" step="0.1"
                className="input"
                defaultValue={settings?.anomalyZThreshold}
                onBlur={e => updateSettings.mutate({ anomalyZThreshold: +e.target.value })}
              />
            </div>
            <div>
              <label className="label">Excursion max chaîne du froid (minutes)</label>
              <input
                type="number" min="0"
                className="input"
                defaultValue={settings?.coldChainMaxExcursionMinutes}
                onBlur={e => updateSettings.mutate({ coldChainMaxExcursionMinutes: +e.target.value })}
              />
            </div>
            <div>
              <label className="label">Fenêtre d'analyse chaîne du froid (heures)</label>
              <input
                type="number" min="0"
                className="input"
                defaultValue={settings?.coldChainLookbackHours}
                onBlur={e => updateSettings.mutate({ coldChainLookbackHours: +e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="col-span-2 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-1 font-semibold text-foreground">Ciblage des alertes</h2>
          <p className="mb-4 text-xs text-tertiary">
            Par défaut, chaque type d'alerte suit le comportement standard de la plateforme.
            Un ciblage personnalisé (ci-dessous) redirige l'alerte vers des utilisateurs, un rôle
            ou une permission spécifiques ; le réinitialiser restaure le comportement par défaut.
          </p>
          {subscriptions?.length === 0 ? (
            <p className="text-sm text-tertiary">Aucun ciblage personnalisé — tous les types d'alerte suivent le comportement par défaut.</p>
          ) : (
            <div className="space-y-3">
              {subscriptions?.map(sub => (
                <div key={sub.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-3">
                    <Bell size={15} className="text-tertiary" />
                    <div>
                      <p className="text-sm text-foreground">{ALERT_LABELS[sub.alertType] ?? sub.alertType}</p>
                      <p className="text-xs text-tertiary">
                        {sub.roleId ? `Rôle : ${sub.roleId}` : sub.permission ? `Permission : ${sub.permission}` : `${sub.userIds?.length ?? 0} utilisateur(s)`}
                      </p>
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-icon btn-sm" title="Réinitialiser au défaut"
                          disabled={resetAlert.isPending}
                          onClick={() => resetAlert.mutate(sub.alertType)}>
                    <RotateCcw size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
