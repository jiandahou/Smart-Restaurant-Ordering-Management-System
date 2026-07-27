import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  clearStoredRefreshToken,
  clearStoredToken,
  confirmEmail as confirmEmailRequest,
  exchangeOAuthCode as exchangeOAuthCodeRequest,
  getMe,
  getStoredRefreshToken,
  getStoredToken,
  login as loginRequest,
  magicLinkLogin as magicLinkLoginRequest,
  passkeyLogin as passkeyLoginRequest,
  storeRefreshToken,
  storeToken,
  updateCurrentUser as updateCurrentUserRequest,
  uploadCurrentUserAvatar as uploadCurrentUserAvatarRequest,
  verifyMfaLogin as verifyMfaLoginRequest,
  type AuthUser,
  type ConfirmEmailRequest,
  type ExchangeOAuthCodeRequest,
  type MagicLinkLoginRequest,
  type LoginResponse,
  type VerifyMfaLoginRequest,
  type UpdateCurrentUserRequest,
} from '../api/auth'

type AuthState = {
  user: AuthUser | null
  token: string | null
  refreshToken: string | null
  loading: boolean
}

const initialToken = getStoredToken()

const initialState: AuthState = {
  user: null,
  token: initialToken,
  refreshToken: getStoredRefreshToken(),
  loading: Boolean(initialToken),
}

export const loadCurrentUser = createAsyncThunk('auth/loadCurrentUser', async () => getMe())

export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async ({ email, password }: { email: string; password: string }) => {
    const response = await loginRequest(email, password)

    if ('token' in response) {
      storeToken(response.token)
      storeRefreshToken(response.refreshToken)
    }

    return response
  },
)

export const verifyMfaLogin = createAsyncThunk(
  'auth/verifyMfaLogin',
  async (payload: VerifyMfaLoginRequest) => {
    const response = await verifyMfaLoginRequest(payload)
    storeToken(response.token)
    storeRefreshToken(response.refreshToken)
    return response
  },
)

export const confirmEmail = createAsyncThunk(
  'auth/confirmEmail',
  async (payload: ConfirmEmailRequest) => {
    const response = await confirmEmailRequest(payload)

    if (response.token && response.refreshToken) {
      storeToken(response.token)
      storeRefreshToken(response.refreshToken)
    }

    return response
  },
)

export const magicLinkLogin = createAsyncThunk(
  'auth/magicLinkLogin',
  async (payload: MagicLinkLoginRequest) => {
    const response = await magicLinkLoginRequest(payload)
    storeToken(response.token)
    storeRefreshToken(response.refreshToken)
    return response
  },
)

export const passkeyLogin = createAsyncThunk(
  'auth/passkeyLogin',
  async () => {
    const response = await passkeyLoginRequest()
    storeToken(response.token)
    storeRefreshToken(response.refreshToken)
    return response
  },
)

export const exchangeOAuthCode = createAsyncThunk(
  'auth/exchangeOAuthCode',
  async (payload: ExchangeOAuthCodeRequest) => {
    const response = await exchangeOAuthCodeRequest(payload)
    storeToken(response.token)
    storeRefreshToken(response.refreshToken)
    return response
  },
)

export const updateCurrentUser = createAsyncThunk(
  'auth/updateCurrentUser',
  async (payload: UpdateCurrentUserRequest) => updateCurrentUserRequest(payload),
)

export const uploadCurrentUserAvatar = createAsyncThunk(
  'auth/uploadCurrentUserAvatar',
  async (file: File) => uploadCurrentUserAvatarRequest(file),
)

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      clearStoredToken()
      clearStoredRefreshToken()
      state.token = null
      state.refreshToken = null
      state.user = null
      state.loading = false
    },
    setToken(state, action: PayloadAction<string | null>) {
      state.token = action.payload
      state.loading = Boolean(action.payload)
    },
    setAuthenticated(state, action: PayloadAction<LoginResponse>) {
      storeToken(action.payload.token)
      storeRefreshToken(action.payload.refreshToken)
      state.token = action.payload.token
      state.refreshToken = action.payload.refreshToken
      state.user = action.payload.user
      state.loading = false
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCurrentUser.pending, (state) => {
        state.loading = true
      })
      .addCase(loadCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload
        state.loading = false
      })
      .addCase(loadCurrentUser.rejected, (state) => {
        // request() already tried a silent refresh before this rejection fired
        // (see auth.ts), so getting here means the refresh token itself is gone
        // or invalid — a real logout is the only remaining option.
        clearStoredToken()
        clearStoredRefreshToken()
        state.token = null
        state.refreshToken = null
        state.user = null
        state.loading = false
      })
      .addCase(loginUser.pending, (state) => {
        state.loading = true
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        if ('token' in action.payload) {
          state.token = action.payload.token
          state.refreshToken = action.payload.refreshToken
          state.user = action.payload.user
        }

        state.loading = false
      })
      .addCase(loginUser.rejected, (state) => {
        state.loading = false
      })
      .addCase(confirmEmail.pending, (state) => {
        state.loading = true
      })
      .addCase(confirmEmail.fulfilled, (state, action) => {
        state.token = action.payload.token ?? state.token
        state.refreshToken = action.payload.refreshToken ?? state.refreshToken
        state.user = action.payload.user ?? state.user
        state.loading = false
      })
      .addCase(confirmEmail.rejected, (state) => {
        state.loading = false
      })
      .addCase(magicLinkLogin.pending, (state) => {
        state.loading = true
      })
      .addCase(magicLinkLogin.fulfilled, (state, action) => {
        state.token = action.payload.token
        state.refreshToken = action.payload.refreshToken
        state.user = action.payload.user
        state.loading = false
      })
      .addCase(magicLinkLogin.rejected, (state) => {
        state.loading = false
      })
      .addCase(passkeyLogin.pending, (state) => {
        state.loading = true
      })
      .addCase(passkeyLogin.fulfilled, (state, action) => {
        state.token = action.payload.token
        state.refreshToken = action.payload.refreshToken
        state.user = action.payload.user
        state.loading = false
      })
      .addCase(passkeyLogin.rejected, (state) => {
        state.loading = false
      })
      .addCase(exchangeOAuthCode.pending, (state) => {
        state.loading = true
      })
      .addCase(exchangeOAuthCode.fulfilled, (state, action) => {
        state.token = action.payload.token
        state.refreshToken = action.payload.refreshToken
        state.user = action.payload.user
        state.loading = false
      })
      .addCase(exchangeOAuthCode.rejected, (state) => {
        state.loading = false
      })
      .addCase(verifyMfaLogin.pending, (state) => {
        state.loading = true
      })
      .addCase(verifyMfaLogin.fulfilled, (state, action) => {
        state.token = action.payload.token
        state.refreshToken = action.payload.refreshToken
        state.user = action.payload.user
        state.loading = false
      })
      .addCase(verifyMfaLogin.rejected, (state) => {
        state.loading = false
      })
      .addCase(updateCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload.user
      })
      .addCase(uploadCurrentUserAvatar.fulfilled, (state, action) => {
        state.user = action.payload.user
      })
  },
})

export const { logout, setAuthenticated, setToken } = authSlice.actions
export default authSlice.reducer
