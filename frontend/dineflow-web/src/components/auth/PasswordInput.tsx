import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useId, useState } from 'react'
import { Input } from '../ui/input'

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, 'type'>

/**
 * A password field with a visibility toggle.
 *
 * <p>Only the input's <c>type</c> changes, so the value, the caret and every field-level attribute
 * survive being toggled — swapping the element out instead would lose what has been typed. The
 * button reports its own state through <c>aria-pressed</c> and carries a label that says what
 * pressing it will do, since the icon alone means nothing to a screen reader.</p>
 *
 * <p>It is deliberately outside the tab order: someone tabbing from the password field expects to
 * reach the submit button, and the toggle is reachable by other means.</p>
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false)
    const describedById = useId()

    return (
      <div className="password-input">
        <Input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={className}
          aria-describedby={props['aria-describedby'] ?? describedById}
        />
        <button
          type="button"
          className="password-input-toggle"
          onClick={() => setVisible((shown) => !shown)}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
        <span id={describedById} className="sr-only">
          {visible ? 'Password is visible.' : 'Password is hidden.'}
        </span>
      </div>
    )
  },
)
