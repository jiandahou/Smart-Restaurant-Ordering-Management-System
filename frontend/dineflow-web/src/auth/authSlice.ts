import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import {
  clearStoredToken,
  confirmEmail as confirmEmailRequest,
  exchangeOAuthCode as exchangeOAuthCodeRequest,
  getMe,
  getStoredToken,
  login as loginRequest,
  magicLinkLogin as magicLinkLoginRequest,
  passkeyLogin as passkeyLoginRequest,
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
  loading: boolean
}

const initialToken = getStoredToken()

const initialState: AuthState = {
  user: null,
  token: initialToken,
  loading: Boolean(initialToken),
}

export const loadCurrentUser = createAsyncThunk('auth/loadCurrentUser', async () => getMe())

export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async ({ email, password }: { email: string; password: string }) => {
    const response = await loginRequest(email, password)

    if ('token' in response) {
      storeToken(response.token)
    }

    return response
  },
)

export const verifyMfaLogin = createAsyncThunk(
  'auth/verifyMfaLogin',
  async (payload: VerifyMfaLoginRequest) => {
    const response = await verifyMfaLoginRequest(payload)
    storeToken(response.token)
    return response
  },
)

export const confirmEmail = createAsyncThunk(
  'auth/confirmEmail',
  async (payload: ConfirmEmailRequest) => {
    const response = await confirmEmailRequest(payload)

    if (response.token) {
      storeToken(response.token)
    }

    return response
  },
)

export const magicLinkLogin = createAsyncThunk(
  'auth/magicLinkLogin',
  async (payload: MagicLinkLoginRequest) => {
    const response = await magicLinkLoginRequest(payload)
    storeToken(response.token)
    return response
  },
)

export const passkeyLogin = createAsyncThunk(
  'auth/passkeyLogin',
  async () => {
    const response = await passkeyLoginRequest()
    storeToken(response.token)
    return response
  },
)

export const exchangeOAuthCode = createAsyncThunk(
  'auth/exchangeOAuthCode',
  async (payload: ExchangeOAuthCodeRequest) => {
    const response = await exchangeOAuthCodeRequest(payload)
    storeToken(response.token)
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
      state.token = null
      state.user = null
      state.loading = false
    },
    setToken(state, action: PayloadAction<string | null>) {
      state.token = action.payload
      state.loading = Boolean(action.payload)
    },
    setAuthenticated(state, action: PayloadAction<LoginResponse>) {
      storeToken(action.payload.token)
      state.token = action.payload.token
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
        clearStoredToken()
        state.token = null
        state.user = null
        state.loading = false
      })
      .addCase(loginUser.pending, (state) => {
        state.loading = true
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        if ('token' in action.payload) {
          state.token = action.payload.token
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
