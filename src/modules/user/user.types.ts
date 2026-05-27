import type { AuthProvider } from "../auth/auth.types";

// Notification Preferences DTO
export interface NotificationPrefsDto {
  browserNotifications: boolean;
  sounds: boolean;
  muteAll: boolean;
}

// Privacy Preferences DTO
export interface PrivacyPrefsDto {
  showOnlineStatus: boolean;
  showLastSeen: boolean;
}

//  Full profile (returned by GET /users/me)
export interface UserProfileDto {
  id: string;
  name: string;
  email: string;
  username: string | null;
  avatar: string | null;
  bio: string | null;
  status: string;
  lastSeen: Date | null;
  provider: AuthProvider;
  isEmailVerified: boolean;
  twoFactorEnabled: boolean;
  notificationPrefs: NotificationPrefsDto;
  privacyPrefs: PrivacyPrefsDto;
  createdAt: Date;
}

// Public profile (returned by GET /users/:id) 
// Other users should NOT see your email, provider, 2FA status, or prefs
export interface PublicUserProfileDto {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  status: string;
  lastSeen: Date | null;
  createdAt: Date;
}

//  Search result (returned by GET /users?search=) 
export interface UserSearchResultDto {
  id: string;
  name: string;
  avatar: string;
  status: "online" | "offline" | "away";
}

// Update profile input 
export interface UpdateProfileInput {
  name?: string;
  username?: string;
  bio?: string;
  avatar?: string;
  avatarPublicId?: string;
}

//  Internal: maps Mongoose doc fields to DTO
// Used by toUserProfileDto() helper in user.service.ts
export interface UserProfileSource {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatar?: string;
  avatarPublicId?: string | null;
  bio?: string;
  status?: string;
  lastSeen?: Date | null;
  provider: AuthProvider;
  isEmailVerified: boolean;
  twoFactorEnabled?: boolean;
  notificationPrefs?: {
    browserNotifications: boolean;
    sounds: boolean;
    muteAll: boolean;
  };
  privacyPrefs?: {
    showOnlineStatus: boolean;
    showLastSeen: boolean;
  };
  createdAt: Date;
}