import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, Camera, ChevronDown, CreditCard, Fingerprint, KeyRound, LockKeyhole, Mail, Pencil, Save, ShieldCheck, Smartphone, Trash2, UserRound, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  deletePasskey,
  disableMfa,
  enableEmailMfa,
  enableTotpMfa,
  getMfaSettings,
  getPasskeys,
  registerPasskey,
  requestCurrentUserPasswordReset,
  requestEmailChange,
  sendSensitiveMfaEmailCode,
  setupEmailMfa,
  setupTotpMfa,
  updateMfaSettings,
  updatePasskey,
  type MfaSettings,
  type MfaVerification,
  type TotpSetupResponse,
  type UserPasskey,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { updateCurrentUser, uploadCurrentUserAvatar } from '../auth/authSlice'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { useAppDispatch } from '../hooks'
import googleLogo from '../assets/google-g.svg'

const profileFormSchema = z.object({
  fullName: z.string().min(1, 'Name is required.'),
})

const emailChangeFormSchema = z.object({
  newEmail: z.email('Enter a valid email address.'),
  currentPassword: z.string().min(1, 'Current password is required.'),
})

const totpFormSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
})

const emailMfaFormSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
})

const sensitiveVerificationFormSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
})

const directPasswordResetFormSchema = z.object({
  password: z.string()
    .min(6, 'Password must be at least 6 characters.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/\d/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a symbol.'),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
})

type ProfileFormValues = z.infer<typeof profileFormSchema>
type EmailChangeFormValues = z.infer<typeof emailChangeFormSchema>
type TotpFormValues = z.infer<typeof totpFormSchema>
type EmailMfaFormValues = z.infer<typeof emailMfaFormSchema>
type SensitiveVerificationFormValues = z.infer<typeof sensitiveVerificationFormSchema>
type DirectPasswordResetFormValues = z.infer<typeof directPasswordResetFormSchema>

type SensitiveAction = {
  title: string
  description: string
  force?: boolean
  onVerify: (verification: MfaVerification) => Promise<void>
}

const allowedAvatarTypes = ['image/jpeg', 'image/png', 'image/webp']
const maxAvatarBytes = 2 * 1024 * 1024

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || 'U'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

export function ProfilePage() {
  const { user } = useAuth()
  const dispatch = useAppDispatch()
  const [sendingResetLink, setSendingResetLink] = useState(false)
  const [registeringPasskey, setRegisteringPasskey] = useState(false)
  const [passkeysOpen, setPasskeysOpen] = useState(false)
  const [loadingPasskeys, setLoadingPasskeys] = useState(false)
  const [passkeys, setPasskeys] = useState<UserPasskey[]>([])
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null)
  const [passkeyNameDraft, setPasskeyNameDraft] = useState('')
  const [updatingPasskeyId, setUpdatingPasskeyId] = useState<string | null>(null)
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null)
  const [mfaSettings, setMfaSettings] = useState<MfaSettings | null>(null)
  const [mfaOpen, setMfaOpen] = useState(false)
  const [loadingMfaSettings, setLoadingMfaSettings] = useState(false)
  const [savingMfaSettings, setSavingMfaSettings] = useState(false)
  const [totpDialogOpen, setTotpDialogOpen] = useState(false)
  const [totpSetup, setTotpSetup] = useState<TotpSetupResponse | null>(null)
  const [startingTotpSetup, setStartingTotpSetup] = useState(false)
  const [emailMfaDialogOpen, setEmailMfaDialogOpen] = useState(false)
  const [startingEmailMfaSetup, setStartingEmailMfaSetup] = useState(false)
  const [disablingMfaMethod, setDisablingMfaMethod] = useState<string | null>(null)
  const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | null>(null)
  const [sensitiveMethod, setSensitiveMethod] = useState('totp')
  const [sendingSensitiveEmailCode, setSendingSensitiveEmailCode] = useState(false)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editingEmail, setEditingEmail] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const canRequestPasswordReset = Boolean(user?.email && user.roles.includes('Customer'))
  const canEditProfile = Boolean(user?.roles.includes('Customer'))
  const canRegisterPasskey = Boolean(user)
  const hasPassword = user?.hasPassword ?? true
  const hasGoogleLogin = Boolean(user?.externalProviders?.some((provider) => provider.toLowerCase() === 'google'))
  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      fullName: user?.fullName ?? '',
    },
  })
  const emailChangeForm = useForm<EmailChangeFormValues>({
    resolver: zodResolver(emailChangeFormSchema),
    defaultValues: {
      newEmail: '',
      currentPassword: '',
    },
  })
  const totpForm = useForm<TotpFormValues>({
    resolver: zodResolver(totpFormSchema),
    defaultValues: {
      code: '',
    },
  })
  const emailMfaForm = useForm<EmailMfaFormValues>({
    resolver: zodResolver(emailMfaFormSchema),
    defaultValues: {
      code: '',
    },
  })
  const sensitiveVerificationForm = useForm<SensitiveVerificationFormValues>({
    resolver: zodResolver(sensitiveVerificationFormSchema),
    defaultValues: {
      code: '',
    },
  })
  const directPasswordResetForm = useForm<DirectPasswordResetFormValues>({
    resolver: zodResolver(directPasswordResetFormSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  useEffect(() => {
    profileForm.reset({
      fullName: user?.fullName ?? '',
    })
  }, [profileForm, user?.fullName])

  useEffect(() => {
    void loadMfaSettings()
  }, [])

  useEffect(() => {
    if (!passkeysOpen) {
      return
    }

    void loadPasskeys()
  }, [passkeysOpen])

  const loadPasskeys = async () => {
    setLoadingPasskeys(true)

    try {
      setPasskeys(await getPasskeys())
    } catch (passkeyError) {
      toast.error('Could not load passkeys', {
        description: passkeyError instanceof Error ? passkeyError.message : 'Passkey list failed to load',
      })
    } finally {
      setLoadingPasskeys(false)
    }
  }

  const loadMfaSettings = async () => {
    setLoadingMfaSettings(true)

    try {
      setMfaSettings(await getMfaSettings())
    } catch (mfaError) {
      toast.error('Could not load MFA settings', {
        description: mfaError instanceof Error ? mfaError.message : 'MFA settings failed to load',
      })
    } finally {
      setLoadingMfaSettings(false)
    }
  }

  const handleProfileSubmit = async (values: ProfileFormValues) => {
    try {
      const response = await dispatch(updateCurrentUser({
        fullName: values.fullName.trim(),
      })).unwrap()

      toast.success('Profile updated', {
        description: response.user.fullName ?? 'Your name was updated.',
      })
      setEditingName(false)
    } catch (profileError) {
      const message = profileError instanceof Error ? profileError.message : 'Profile update failed'
      toast.error('Could not update profile', {
        description: message,
      })
      profileForm.setError('root', { message })
    }
  }

  const handleCancelNameEdit = () => {
    profileForm.reset({
      fullName: user?.fullName ?? '',
    })
    setEditingName(false)
  }

  const handleEmailChangeSubmit = async (values: EmailChangeFormValues) => {
    try {
      const response = await requestEmailChange({
        newEmail: values.newEmail.trim(),
        currentPassword: values.currentPassword,
      })

      toast.success('Verification email sent', {
        description: response.message,
      })
      emailChangeForm.reset({
        newEmail: '',
        currentPassword: '',
      })
      setEditingEmail(false)
    } catch (emailChangeError) {
      const message = emailChangeError instanceof Error ? emailChangeError.message : 'Email change failed'
      toast.error('Could not request email change', {
        description: message,
      })
      emailChangeForm.setError('root', { message })
    }
  }

  const handleCancelEmailEdit = () => {
    emailChangeForm.reset({
      newEmail: '',
      currentPassword: '',
    })
    setEditingEmail(false)
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!allowedAvatarTypes.includes(file.type)) {
      toast.error('Unsupported avatar file', {
        description: 'Use a JPG, PNG, or WebP image.',
      })
      return
    }

    if (file.size > maxAvatarBytes) {
      toast.error('Avatar is too large', {
        description: 'Use an image that is 2MB or smaller.',
      })
      return
    }

    setUploadingAvatar(true)

    try {
      const response = await dispatch(uploadCurrentUserAvatar(file)).unwrap()

      toast.success('Avatar updated', {
        description: response.user.email ?? 'Your profile image was updated.',
      })
    } catch (avatarError) {
      toast.error('Could not update avatar', {
        description: avatarError instanceof Error ? avatarError.message : 'Avatar upload failed',
      })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const getAvailableMfaMethods = () => {
    const methods: string[] = []

    if (mfaSettings?.totp.enabled) {
      methods.push('totp')
    }

    if (mfaSettings?.email.enabled) {
      methods.push('email')
    }

    return methods
  }

  const runSensitiveAction = (action: SensitiveAction) => {
    const methods = getAvailableMfaMethods()

    if ((!action.force && !mfaSettings?.requiredFor.sensitiveActions) || methods.length === 0) {
      void action.onVerify({ method: '', code: '' })
      return
    }

    const preferredMethod = mfaSettings && methods.includes(mfaSettings.preferredMethod)
      ? mfaSettings.preferredMethod
      : methods[0]

    setSensitiveMethod(preferredMethod)
    setSensitiveAction(action)
    sensitiveVerificationForm.reset({ code: '' })
  }

  const handleSensitiveVerificationSubmit = async (values: SensitiveVerificationFormValues) => {
    if (!sensitiveAction) {
      return
    }

    try {
      await sensitiveAction.onVerify({
        method: sensitiveMethod,
        code: values.code,
      })
      setSensitiveAction(null)
      sensitiveVerificationForm.reset({ code: '' })
    } catch (verificationError) {
      const message = verificationError instanceof Error ? verificationError.message : 'MFA verification failed'

      toast.error('Verification failed', {
        description: message,
      })
      sensitiveVerificationForm.setError('root', { message })
    }
  }

  const handleSendSensitiveEmailCode = async () => {
    setSendingSensitiveEmailCode(true)

    try {
      const response = await sendSensitiveMfaEmailCode()

      toast.success('Email code sent', {
        description: response.message,
      })
    } catch (mfaError) {
      toast.error('Could not send email code', {
        description: mfaError instanceof Error ? mfaError.message : 'MFA email code failed',
      })
    } finally {
      setSendingSensitiveEmailCode(false)
    }
  }

  const handleResetPassword = async () => {
    if (!user?.email) {
      toast.error('No email on this account')
      return
    }

    if (mfaSettings?.requiredFor.sensitiveActions && getAvailableMfaMethods().length > 0) {
      directPasswordResetForm.reset({
        password: '',
        confirmPassword: '',
      })
      setPasswordDialogOpen(true)
      return
    }

    await requestPasswordResetWithVerification({ method: '', code: '' })
  }

  const handleDirectPasswordResetSubmit = (values: DirectPasswordResetFormValues) => {
    setPasswordDialogOpen(false)

    runSensitiveAction({
      title: 'Verify password change',
      description: 'Enter an MFA code to update your password.',
      onVerify: async (verification) => {
        await requestPasswordResetWithVerification(verification, values.password)
      },
    })
  }

  const requestPasswordResetWithVerification = async (verification: MfaVerification, password?: string) => {
    setSendingResetLink(true)

    try {
      const response = await requestCurrentUserPasswordReset({
        password,
        verification: verification.method ? verification : undefined,
      })

      toast.success(password ? 'Password updated' : 'Reset link sent', {
        description: response.message,
      })
      directPasswordResetForm.reset({
        password: '',
        confirmPassword: '',
      })
    } catch (resetError) {
      toast.error(password ? 'Could not update password' : 'Could not send reset link', {
        description: resetError instanceof Error ? resetError.message : 'Password reset failed',
      })
    } finally {
      setSendingResetLink(false)
    }
  }

  const handleRegisterPasskey = async () => {
    runSensitiveAction({
      title: 'Verify passkey setup',
      description: 'Enter an MFA code before adding a new passkey.',
      onVerify: async (verification) => {
        await registerPasskeyWithVerification(verification)
      },
    })
  }

  const registerPasskeyWithVerification = async (verification: MfaVerification) => {
    setRegisteringPasskey(true)

    try {
      const deviceName = buildPasskeyDeviceName()
      const response = await registerPasskey(deviceName, verification.method ? verification : undefined)

      toast.success('Passkey added', {
        description: response.passkey.deviceName ?? response.message,
      })
      await loadPasskeys()
      setPasskeysOpen(true)
    } catch (passkeyError) {
      toast.error('Could not add passkey', {
        description: passkeyError instanceof Error ? passkeyError.message : 'Passkey registration failed',
      })
    } finally {
      setRegisteringPasskey(false)
    }
  }

  const startEditingPasskey = (passkey: UserPasskey) => {
    setEditingPasskeyId(passkey.id)
    setPasskeyNameDraft(passkey.deviceName ?? '')
  }

  const cancelEditingPasskey = () => {
    setEditingPasskeyId(null)
    setPasskeyNameDraft('')
  }

  const handleUpdatePasskey = async (passkeyId: string) => {
    const nextName = passkeyNameDraft.trim()

    if (!nextName) {
      toast.error('Passkey name is required')
      return
    }

    runSensitiveAction({
      title: 'Verify passkey rename',
      description: 'Enter an MFA code before renaming this passkey.',
      onVerify: async (verification) => {
        await updatePasskeyWithVerification(passkeyId, nextName, verification)
      },
    })
  }

  const updatePasskeyWithVerification = async (
    passkeyId: string,
    nextName: string,
    verification: MfaVerification,
  ) => {
    setUpdatingPasskeyId(passkeyId)

    try {
      const response = await updatePasskey(
        passkeyId,
        nextName,
        verification.method ? verification : undefined,
      )

      setPasskeys((currentPasskeys) =>
        currentPasskeys.map((passkey) =>
          passkey.id === passkeyId ? response.passkey : passkey,
        ),
      )
      toast.success('Passkey renamed', {
        description: response.passkey.deviceName ?? response.message,
      })
      cancelEditingPasskey()
    } catch (passkeyError) {
      toast.error('Could not rename passkey', {
        description: passkeyError instanceof Error ? passkeyError.message : 'Passkey update failed',
      })
    } finally {
      setUpdatingPasskeyId(null)
    }
  }

  const handleDeletePasskey = async (passkey: UserPasskey) => {
    runSensitiveAction({
      title: 'Verify passkey deletion',
      description: `Enter an MFA code before deleting ${passkey.deviceName || 'this passkey'}.`,
      onVerify: async (verification) => {
        await deletePasskeyWithVerification(passkey, verification)
      },
    })
  }

  const deletePasskeyWithVerification = async (
    passkey: UserPasskey,
    verification: MfaVerification,
  ) => {
    setDeletingPasskeyId(passkey.id)

    try {
      const response = await deletePasskey(passkey.id, verification.method ? verification : undefined)

      setPasskeys((currentPasskeys) =>
        currentPasskeys.filter((currentPasskey) => currentPasskey.id !== passkey.id),
      )
      toast.success('Passkey deleted', {
        description: passkey.deviceName ?? response.message,
      })
    } catch (passkeyError) {
      toast.error('Could not delete passkey', {
        description: passkeyError instanceof Error ? passkeyError.message : 'Passkey delete failed',
      })
    } finally {
      setDeletingPasskeyId(null)
    }
  }

  const handleStartTotpSetup = async () => {
    setStartingTotpSetup(true)

    try {
      const response = await setupTotpMfa()

      setTotpSetup(response)
      totpForm.reset({ code: '' })
      setTotpDialogOpen(true)
    } catch (mfaError) {
      toast.error('Could not start MFA setup', {
        description: mfaError instanceof Error ? mfaError.message : 'TOTP setup failed',
      })
    } finally {
      setStartingTotpSetup(false)
    }
  }

  const handleTotpDialogOpenChange = (open: boolean) => {
    setTotpDialogOpen(open)

    if (!open) {
      setTotpSetup(null)
      totpForm.reset({ code: '' })
    }
  }

  const handleEnableTotp = async (values: TotpFormValues) => {
    try {
      const response = await enableTotpMfa(values.code)

      setMfaSettings(response.settings)
      toast.success('MFA enabled', {
        description: response.message,
      })
      handleTotpDialogOpenChange(false)
    } catch (mfaError) {
      const message = mfaError instanceof Error ? mfaError.message : 'TOTP verification failed'

      toast.error('Could not enable MFA', {
        description: message,
      })
      totpForm.setError('root', { message })
    }
  }

  const handleStartEmailMfaSetup = async () => {
    setStartingEmailMfaSetup(true)

    try {
      const response = await setupEmailMfa()

      emailMfaForm.reset({ code: '' })
      setEmailMfaDialogOpen(true)
      toast.success('Email code sent', {
        description: response.message,
      })
    } catch (mfaError) {
      toast.error('Could not start email MFA', {
        description: mfaError instanceof Error ? mfaError.message : 'Email MFA setup failed',
      })
    } finally {
      setStartingEmailMfaSetup(false)
    }
  }

  const handleEmailMfaDialogOpenChange = (open: boolean) => {
    setEmailMfaDialogOpen(open)

    if (!open) {
      emailMfaForm.reset({ code: '' })
    }
  }

  const handleEnableEmailMfa = async (values: EmailMfaFormValues) => {
    try {
      const response = await enableEmailMfa(values.code)

      setMfaSettings(response.settings)
      toast.success('Email MFA enabled', {
        description: response.message,
      })
      handleEmailMfaDialogOpenChange(false)
    } catch (mfaError) {
      const message = mfaError instanceof Error ? mfaError.message : 'Email MFA verification failed'

      toast.error('Could not enable email MFA', {
        description: message,
      })
      emailMfaForm.setError('root', { message })
    }
  }

  const handleDisableMfa = async (method: 'totp' | 'email' | 'all') => {
    runSensitiveAction({
      title: method === 'all' ? 'Verify disabling all MFA' : `Verify disabling ${method.toUpperCase()} MFA`,
      description: 'Enter an MFA code before reducing account protection.',
      force: true,
      onVerify: async (verification) => {
        await disableMfaWithVerification(method, verification)
      },
    })
  }

  const disableMfaWithVerification = async (
    method: 'totp' | 'email' | 'all',
    verification: MfaVerification,
  ) => {
    setDisablingMfaMethod(method)

    try {
      const response = await disableMfa(method, verification.method ? verification : undefined)

      setMfaSettings(response.settings)
      toast.success('MFA updated', {
        description: response.message,
      })
    } catch (mfaError) {
      toast.error('Could not disable MFA', {
        description: mfaError instanceof Error ? mfaError.message : 'MFA disable failed',
      })
    } finally {
      setDisablingMfaMethod(null)
    }
  }

  const handleMfaScopeChange = async (
    key: keyof MfaSettings['requiredFor'],
    checked: boolean,
  ) => {
    if (!mfaSettings) {
      return
    }

    const nextRequiredFor = {
      ...mfaSettings.requiredFor,
      [key]: checked,
    }

    setSavingMfaSettings(true)

    try {
      const response = await updateMfaSettings({
        requireForLogin: nextRequiredFor.login,
        requireForPayment: nextRequiredFor.payment,
        requireForSensitiveActions: nextRequiredFor.sensitiveActions,
      })

      setMfaSettings(response.settings)
      toast.success('MFA settings saved', {
        description: response.message,
      })
    } catch (mfaError) {
      toast.error('Could not save MFA settings', {
        description: mfaError instanceof Error ? mfaError.message : 'MFA settings update failed',
      })
    } finally {
      setSavingMfaSettings(false)
    }
  }

  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <CardTitle>User Center</CardTitle>
        </CardHeader>
        <CardContent className="profile-stack">
          <div className="avatar-panel">
            <Avatar className="profile-avatar">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? user.email ?? 'User avatar'} />}
              <AvatarFallback>{getInitials(user?.fullName, user?.email)}</AvatarFallback>
            </Avatar>
            <div className="avatar-copy">
              <strong>{user?.fullName || user?.email || 'Profile avatar'}</strong>
              <span>JPG, PNG, or WebP. Maximum 2MB.</span>
            </div>
            <input
              ref={avatarInputRef}
              className="hidden-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarChange}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              <Camera size={18} />
              {uploadingAvatar ? 'Uploading' : 'Upload avatar'}
            </Button>
          </div>
          <div className="profile-grid">
            <div className="info-row">
              <UserRound size={20} />
              <div className="info-row-content">
                <span>Name</span>
                {editingName ? (
                  <Form {...profileForm}>
                    <form className="inline-edit-form" onSubmit={profileForm.handleSubmit(handleProfileSubmit)}>
                      <FormField
                        control={profileForm.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem className="inline-edit-field">
                            <FormControl>
                              <Input autoComplete="name" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {profileForm.formState.errors.root && (
                        <p className="form-error inline-edit-error">{profileForm.formState.errors.root.message}</p>
                      )}
                      <div className="inline-edit-actions">
                        <Button type="submit" size="sm" disabled={profileForm.formState.isSubmitting}>
                          <Save size={16} />
                          {profileForm.formState.isSubmitting ? 'Saving' : 'Save'}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={handleCancelNameEdit}>
                          <X size={16} />
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </Form>
                ) : (
                  <strong>{user?.fullName || 'Not set'}</strong>
                )}
              </div>
              {canEditProfile && !editingName && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditingName(true)}>
                  <Pencil size={16} />
                  Edit
                </Button>
              )}
            </div>
            <div className="info-row">
              <Mail size={20} />
              <div>
                <span>Email</span>
                <div className="identity-line">
                  <strong>{user?.email}</strong>
                  {hasGoogleLogin && (
                    <span className="google-linked-mark" aria-label="Google linked account" title="Google linked account">
                      <img aria-hidden="true" src={googleLogo} alt="" />
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="info-row">
              <Building2 size={20} />
              <div>
                <span>Restaurant</span>
                <strong>{user?.restaurantId || 'Platform scope'}</strong>
              </div>
            </div>
            <div className="info-row">
              <ShieldCheck size={20} />
              <div>
                <span>Roles</span>
                <div className="badge-row">
                  {user?.roles.map((role) => (
                    <Badge key={role}>{role}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Manage account sign-in and verification options.</CardDescription>
        </CardHeader>
        <CardContent className="security-grid">
          <div className={`security-row ${editingEmail ? 'editing' : ''}`}>
            <div className="security-copy">
              <Mail size={20} />
              <div>
                <strong>Email address</strong>
                <span>Confirm your password, then verify the new email address.</span>
              </div>
            </div>
            {editingEmail ? (
              <Form {...emailChangeForm}>
                <form className="security-inline-form" onSubmit={emailChangeForm.handleSubmit(handleEmailChangeSubmit)}>
                  <FormField
                    control={emailChangeForm.control}
                    name="newEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" placeholder="new@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={emailChangeForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Current password</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="current-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {emailChangeForm.formState.errors.root && (
                    <p className="form-error">{emailChangeForm.formState.errors.root.message}</p>
                  )}
                  <div className="inline-edit-actions">
                    <Button type="submit" size="sm" disabled={emailChangeForm.formState.isSubmitting}>
                      <Mail size={16} />
                      {emailChangeForm.formState.isSubmitting ? 'Sending' : 'Send verification'}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={handleCancelEmailEdit}>
                      <X size={16} />
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditingEmail(true)}
                disabled={!canEditProfile}
              >
                <Pencil size={18} />
                Change email
              </Button>
            )}
          </div>
          <div className="security-row">
            <div className="security-copy">
              <KeyRound size={20} />
              <div>
                <strong>Password</strong>
                <span>
                  {!hasPassword
                    ? 'Set a password so you can also sign in without Google.'
                    : mfaSettings?.requiredFor.sensitiveActions && getAvailableMfaMethods().length > 0
                    ? 'Use MFA to update your password directly.'
                    : 'Send a verified reset link to your account email.'}
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleResetPassword}
              disabled={!canRequestPasswordReset || sendingResetLink}
            >
              <KeyRound size={18} />
              {sendingResetLink
                ? 'Working'
                : !hasPassword
                  ? 'Set password'
                  : mfaSettings?.requiredFor.sensitiveActions && getAvailableMfaMethods().length > 0
                  ? 'Change password'
                  : 'Reset my password'}
            </Button>
          </div>
          <Collapsible open={mfaOpen} onOpenChange={setMfaOpen}>
            <div className="security-row mfa-row">
              <CollapsibleTrigger asChild>
                <button type="button" className="security-copy mfa-trigger">
                  <Smartphone size={20} />
                  <div>
                    <strong className="mfa-title">
                      Multi-factor authentication
                      <ChevronDown className="passkey-chevron" size={17} aria-hidden="true" />
                    </strong>
                    <span>
                      {mfaSettings?.enabled
                        ? 'Extra verification is ready for selected account actions.'
                        : 'Add a second verification step for account protection.'}
                    </span>
                  </div>
                </button>
              </CollapsibleTrigger>
              <div className="mfa-summary">
                <Badge variant={mfaSettings?.enabled ? 'default' : 'secondary'}>
                  {loadingMfaSettings ? 'Loading' : mfaSettings?.enabled ? 'Protected' : 'Not enabled'}
                </Badge>
                {mfaSettings?.requiredFor.login && (
                  <Badge variant="secondary" className="mfa-summary-badge">
                    <LockKeyhole size={12} />
                    Login
                  </Badge>
                )}
                {mfaSettings?.requiredFor.payment && (
                  <Badge variant="secondary" className="mfa-summary-badge">
                    <CreditCard size={12} />
                    Payment
                  </Badge>
                )}
                {mfaSettings?.requiredFor.sensitiveActions && (
                  <Badge variant="secondary" className="mfa-summary-badge">
                    <ShieldCheck size={12} />
                    Sensitive actions
                  </Badge>
                )}
              </div>
            </div>
            <CollapsibleContent>
              <div className="mfa-detail-panel">
                <div className="mfa-method-grid">
                  <div className={`mfa-method-card ${mfaSettings?.totp.enabled ? 'enabled' : ''}`}>
                    <div className="mfa-method-icon">
                      <ShieldCheck size={18} />
                    </div>
                    <div className="mfa-method-copy">
                      <strong>Authenticator app</strong>
                      <span>Use a 6-digit code from Google Authenticator, 1Password, or another TOTP app.</span>
                      {mfaSettings?.totp.enabled && (
                        <Badge variant="default" className="mfa-configured-badge">
                          <ShieldCheck size={13} />
                          Configured
                        </Badge>
                      )}
                    </div>
                    {!mfaSettings?.totp.enabled && <Badge variant="secondary">Off</Badge>}
                    {!mfaSettings?.totp.enabled && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleStartTotpSetup}
                        disabled={startingTotpSetup || loadingMfaSettings}
                      >
                        <ShieldCheck size={16} />
                        {startingTotpSetup ? 'Starting' : 'Set up'}
                      </Button>
                    )}
                    {mfaSettings?.totp.enabled && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void handleDisableMfa('totp')}
                        disabled={disablingMfaMethod !== null}
                      >
                        <X size={16} />
                        {disablingMfaMethod === 'totp' ? 'Disabling' : 'Disable'}
                      </Button>
                    )}
                  </div>
                  <div className={`mfa-method-card ${mfaSettings?.email.enabled ? 'enabled' : ''}`}>
                    <div className="mfa-method-icon">
                      <Mail size={18} />
                    </div>
                    <div className="mfa-method-copy">
                      <strong>Email code</strong>
                      <span>Receive a 6-digit code by email as a backup verification method.</span>
                      {mfaSettings?.email.enabled && (
                        <Badge variant="default" className="mfa-configured-badge">
                          <Mail size={13} />
                          Configured
                        </Badge>
                      )}
                    </div>
                    {!mfaSettings?.email.enabled && <Badge variant="secondary">Off</Badge>}
                    {!mfaSettings?.email.enabled && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleStartEmailMfaSetup}
                        disabled={startingEmailMfaSetup || loadingMfaSettings}
                      >
                        <Mail size={16} />
                        {startingEmailMfaSetup ? 'Sending' : 'Set up'}
                      </Button>
                    )}
                    {mfaSettings?.email.enabled && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void handleDisableMfa('email')}
                        disabled={disablingMfaMethod !== null}
                      >
                        <X size={16} />
                        {disablingMfaMethod === 'email' ? 'Disabling' : 'Disable'}
                      </Button>
                    )}
                  </div>
                </div>
                {mfaSettings?.enabled && (
                  <div className="mfa-danger-row">
                    <div>
                      <strong>Turn off all MFA</strong>
                      <span>Disable every MFA method and clear protected action requirements.</span>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void handleDisableMfa('all')}
                      disabled={disablingMfaMethod !== null}
                    >
                      <X size={16} />
                      {disablingMfaMethod === 'all' ? 'Disabling' : 'Disable all'}
                    </Button>
                  </div>
                )}
                <div className="mfa-scope-grid">
                  <MfaScopeSwitch
                    icon={LockKeyhole}
                    title="Login"
                    description="Ask for MFA when this account signs in."
                    checked={Boolean(mfaSettings?.requiredFor.login)}
                    disabled={!mfaSettings?.enabled || loadingMfaSettings || savingMfaSettings}
                    onCheckedChange={(checked) => void handleMfaScopeChange('login', checked)}
                  />
                  <MfaScopeSwitch
                    icon={CreditCard}
                    title="Payment"
                    description="Require MFA before payment and payout actions."
                    checked={Boolean(mfaSettings?.requiredFor.payment)}
                    disabled={!mfaSettings?.enabled || loadingMfaSettings || savingMfaSettings}
                    onCheckedChange={(checked) => void handleMfaScopeChange('payment', checked)}
                  />
                  <MfaScopeSwitch
                    icon={ShieldCheck}
                    title="Sensitive actions"
                    description="Protect security changes and account recovery actions."
                    checked={Boolean(mfaSettings?.requiredFor.sensitiveActions)}
                    disabled={!mfaSettings?.enabled || loadingMfaSettings || savingMfaSettings}
                    onCheckedChange={(checked) => void handleMfaScopeChange('sensitiveActions', checked)}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Dialog open={totpDialogOpen} onOpenChange={handleTotpDialogOpenChange}>
            <DialogContent className="totp-dialog">
              <DialogHeader>
                <DialogTitle>Set up authenticator app</DialogTitle>
                <DialogDescription>
                  Scan the QR code, then enter the 6-digit code from your authenticator app.
                </DialogDescription>
              </DialogHeader>
              {totpSetup && (
                <div className="totp-setup-grid">
                  <div className="totp-qr-wrap">
                    <QRCodeSVG value={totpSetup.otpauthUri} size={188} />
                  </div>
                  <div className="totp-manual-key">
                    <span>Manual key</span>
                    <strong>{totpSetup.secret}</strong>
                  </div>
                  <Form {...totpForm}>
                    <form className="totp-form" onSubmit={totpForm.handleSubmit(handleEnableTotp)}>
                      <FormField
                        control={totpForm.control}
                        name="code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>6-digit code</FormLabel>
                            <FormControl>
                              <Input
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                placeholder="123456"
                                {...field}
                                onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {totpForm.formState.errors.root && (
                        <p className="form-error">{totpForm.formState.errors.root.message}</p>
                      )}
                      <DialogFooter>
                        <Button type="button" variant="secondary" onClick={() => handleTotpDialogOpenChange(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={totpForm.formState.isSubmitting}>
                          <ShieldCheck size={16} />
                          {totpForm.formState.isSubmitting ? 'Verifying' : 'Enable MFA'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <Dialog open={emailMfaDialogOpen} onOpenChange={handleEmailMfaDialogOpenChange}>
            <DialogContent className="totp-dialog">
              <DialogHeader>
                <DialogTitle>Set up email MFA</DialogTitle>
                <DialogDescription>
                  Enter the 6-digit code sent to {user?.email ?? 'your email address'}.
                </DialogDescription>
              </DialogHeader>
              <Form {...emailMfaForm}>
                <form className="totp-form" onSubmit={emailMfaForm.handleSubmit(handleEnableEmailMfa)}>
                  <FormField
                    control={emailMfaForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>6-digit code</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="123456"
                            {...field}
                            onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {emailMfaForm.formState.errors.root && (
                    <p className="form-error">{emailMfaForm.formState.errors.root.message}</p>
                  )}
                  <DialogFooter>
                    <Button type="button" variant="secondary" onClick={() => handleEmailMfaDialogOpenChange(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={emailMfaForm.formState.isSubmitting}>
                      <Mail size={16} />
                      {emailMfaForm.formState.isSubmitting ? 'Verifying' : 'Enable email MFA'}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={passwordDialogOpen}
            onOpenChange={(open) => {
              setPasswordDialogOpen(open)

              if (!open) {
                directPasswordResetForm.reset({
                  password: '',
                  confirmPassword: '',
                })
              }
            }}
          >
            <DialogContent className="totp-dialog">
              <DialogHeader>
                <DialogTitle>{hasPassword ? 'Change password' : 'Set password'}</DialogTitle>
                <DialogDescription>
                  Enter a password for this account. MFA verification will be required before it is saved.
                </DialogDescription>
              </DialogHeader>
              <Form {...directPasswordResetForm}>
                <form
                  className="totp-form"
                  onSubmit={directPasswordResetForm.handleSubmit(handleDirectPasswordResetSubmit)}
                >
                  <FormField
                    control={directPasswordResetForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New password</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={directPasswordResetForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm password</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="button" variant="secondary" onClick={() => setPasswordDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      <LockKeyhole size={16} />
                      Continue
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(sensitiveAction)}
            onOpenChange={(open) => {
              if (!open) {
                setSensitiveAction(null)
                sensitiveVerificationForm.reset({ code: '' })
              }
            }}
          >
            <DialogContent className="totp-dialog">
              <DialogHeader>
                <DialogTitle>{sensitiveAction?.title ?? 'Verify sensitive action'}</DialogTitle>
                <DialogDescription>
                  {sensitiveAction?.description ?? 'Enter an MFA code to continue.'}
                </DialogDescription>
              </DialogHeader>
              <Form {...sensitiveVerificationForm}>
                <form className="totp-form" onSubmit={sensitiveVerificationForm.handleSubmit(handleSensitiveVerificationSubmit)}>
                  {getAvailableMfaMethods().length > 1 && (
                    <div className="mfa-method-tabs" role="group" aria-label="MFA method">
                      {getAvailableMfaMethods().map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={sensitiveMethod === method ? 'default' : 'secondary'}
                          onClick={() => {
                            setSensitiveMethod(method)
                            sensitiveVerificationForm.reset({ code: '' })
                          }}
                        >
                          {method === 'email' ? <Mail size={16} /> : <ShieldCheck size={16} />}
                          {method === 'email' ? 'Email code' : 'Authenticator'}
                        </Button>
                      ))}
                    </div>
                  )}
                  {sensitiveMethod === 'email' && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleSendSensitiveEmailCode()}
                      disabled={sendingSensitiveEmailCode}
                    >
                      <Mail size={16} />
                      {sendingSensitiveEmailCode ? 'Sending code' : 'Send email code'}
                    </Button>
                  )}
                  <FormField
                    control={sensitiveVerificationForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>6-digit code</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="123456"
                            {...field}
                            onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {sensitiveVerificationForm.formState.errors.root && (
                    <p className="form-error">{sensitiveVerificationForm.formState.errors.root.message}</p>
                  )}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setSensitiveAction(null)
                        sensitiveVerificationForm.reset({ code: '' })
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={sensitiveVerificationForm.formState.isSubmitting}>
                      <ShieldCheck size={16} />
                      {sensitiveVerificationForm.formState.isSubmitting ? 'Verifying' : 'Verify'}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          <Collapsible open={passkeysOpen} onOpenChange={setPasskeysOpen}>
            <div className="security-row passkey-row">
              <CollapsibleTrigger asChild>
                <button type="button" className="security-copy passkey-trigger">
                  <Fingerprint size={20} />
                  <div>
                    <strong className="passkey-title">
                      Passkeys
                      <ChevronDown className="passkey-chevron" size={17} aria-hidden="true" />
                    </strong>
                    <span>Use device biometrics or security keys for passwordless sign-in.</span>
                  </div>
                </button>
              </CollapsibleTrigger>
              <Button
                type="button"
                variant="secondary"
                onClick={handleRegisterPasskey}
                disabled={!canRegisterPasskey || registeringPasskey}
              >
                <Fingerprint size={18} />
                {registeringPasskey ? 'Adding passkey' : 'Add passkey'}
              </Button>
            </div>
            <CollapsibleContent>
              <div className="passkey-list">
                {loadingPasskeys ? (
                  <p className="passkey-empty">Loading passkeys...</p>
                ) : passkeys.length === 0 ? (
                  <p className="passkey-empty">No passkeys have been added yet.</p>
                ) : (
                  passkeys.map((passkey) => (
                    <div className="passkey-item" key={passkey.id}>
                      <Fingerprint size={18} />
                      <div className="passkey-item-copy">
                        {editingPasskeyId === passkey.id ? (
                          <div className="passkey-edit-form">
                            <Input
                              aria-label="Passkey name"
                              value={passkeyNameDraft}
                              onChange={(event) => setPasskeyNameDraft(event.target.value)}
                            />
                            <div className="inline-edit-actions">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void handleUpdatePasskey(passkey.id)}
                                disabled={updatingPasskeyId === passkey.id}
                              >
                                <Save size={16} />
                                {updatingPasskeyId === passkey.id ? 'Saving' : 'Save'}
                              </Button>
                              <Button type="button" size="sm" variant="secondary" onClick={cancelEditingPasskey}>
                                <X size={16} />
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <strong>{passkey.deviceName || 'Unnamed passkey'}</strong>
                            <span>
                              Created {formatDateTime(passkey.createdAt)}
                              {passkey.lastUsedAt ? ` - Last used ${formatDateTime(passkey.lastUsedAt)}` : ''}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="passkey-item-actions">
                        {passkey.isBackedUp && <Badge variant="secondary">Synced</Badge>}
                        <Button type="button" size="sm" variant="secondary" onClick={() => startEditingPasskey(passkey)}>
                          <Pencil size={16} />
                          Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" size="sm" variant="destructive" disabled={deletingPasskeyId === passkey.id}>
                              <Trash2 size={16} />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete passkey?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes {passkey.deviceName || 'this passkey'} from your DineFlow account.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => void handleDeletePasskey(passkey)}
                              >
                                Delete passkey
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </main>
  )
}

function MfaScopeSwitch({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: LucideIcon
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="mfa-scope-item">
      <div className="mfa-scope-copy">
        <Icon size={18} />
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function buildPasskeyDeviceName() {
  const platform = navigator.platform || 'This device'

  return `${platform} passkey`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
