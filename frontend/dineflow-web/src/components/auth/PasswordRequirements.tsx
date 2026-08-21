import { Check, X } from 'lucide-react'
import { evaluatePassword } from '@/lib/passwordPolicy'

/**
 * Live checklist of what the password still needs. Shown as the user types rather than only on
 * submit, so nobody has to discover the rules one rejected attempt at a time.
 */
export function PasswordRequirements({
  password,
  className,
}: {
  password: string
  className?: string
}) {
  const rules = evaluatePassword(password)
  const metCount = rules.filter((rule) => rule.met).length

  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {metCount === rules.length
          ? 'Password meets all requirements.'
          : `Password needs ${rules.length - metCount} more of:`}
      </p>
      <ul className="mt-1 grid gap-1">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={`flex items-center gap-1.5 text-xs ${
              rule.met ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
            }`}
          >
            {rule.met
              ? <Check className="size-3.5 shrink-0" aria-hidden />
              : <X className="size-3.5 shrink-0 opacity-60" aria-hidden />}
            <span>{rule.label}</span>
            <span className="sr-only">{rule.met ? '— met' : '— still needed'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
