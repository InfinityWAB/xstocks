import { cn } from '../lib/utils'

const VARIANTS: Record<string, string> = {
  active:       'badge-success',
  inactive:     'badge-neutral',
  draft:        'badge-draft',
  ready:        'badge-info',
  done:         'badge-success',
  cancelled:    'badge-danger',
  open:         'badge-info',
  validated:    'badge-success',
  confirmed:    'badge-success',
  shipped:      'badge-approved',
  partially_shipped: 'badge-warning',
  in_transit:   'badge-warning',
  low_stock:    'badge-warning',
  out_of_stock: 'badge-danger',
  overstock:    'badge-info',
  quarantined:  'badge-danger',
  expired:      'badge-danger',
  true:         'badge-success',
  false:        'badge-neutral',
}

type StatusBadgeProps = {
  status: string | boolean | null | undefined
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const key = String(status ?? '')
  const variant = VARIANTS[key] ?? 'badge-neutral'
  return (
    <span className={cn('badge', variant, className)}>
      {label ?? String(status ?? '—')}
    </span>
  )
}
