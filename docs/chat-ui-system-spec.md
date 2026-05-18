# BlinkChat UI System Spec

This document defines a complete, production-ready UI system for a real-time chat application. It is written to be recreated directly in Figma or implemented in a frontend without rethinking layout, states, or interactions.

Scope note:
- The current backend in this repo already supports auth, conversations, messages, typing, presence, delivery, read updates, and message sync.
- Google auth, user search, and call screens are included as first-class UI surfaces because they are part of the requested product scope. They are UI-ready even if some server endpoints are not fully exposed yet.

## 1. Product Direction

Visual thesis:
- Calm, modern messenger with flat surfaces, clear hierarchy, and one crisp cobalt accent.

Content plan:
- Fast entry into the inbox, zero visual clutter inside the thread, and status-first utility copy.

Interaction thesis:
- Quick fade-slide transitions for screen changes, subtle state shifts on send/reconnect, and lightweight message-entry motion that never distracts from reading.

Design principles:
- Mobile-first, then expand to tablet and desktop.
- Use layout, spacing, and typography before borders and shadows.
- Keep the app shell plain; let conversation content be the focus.
- Use one accent color for action, one warning color for disruption, and one error color for failure.
- Show state changes clearly: typing, sending, failed, reconnecting, unread, delivered, read.

## 2. Design Tokens

### 2.1 Color Tokens

Light mode:

| Token | Value | Usage |
| --- | --- | --- |
| `--color-bg-app` | `#F8FAFC` | App background |
| `--color-bg-surface` | `#FFFFFF` | Panels, sheets, forms |
| `--color-bg-surface-muted` | `#F1F5F9` | Sidebar search, disabled inputs, incoming bubble |
| `--color-bg-surface-hover` | `#EEF2F7` | Hover row background |
| `--color-border-soft` | `#E2E8F0` | Dividers, field borders |
| `--color-border-strong` | `#CBD5E1` | Focus-adjacent inactive borders |
| `--color-text-primary` | `#0F172A` | Main text |
| `--color-text-secondary` | `#475569` | Secondary text |
| `--color-text-tertiary` | `#64748B` | Timestamps, helper copy |
| `--color-primary-500` | `#2563EB` | Primary CTA, unread badge, active state |
| `--color-primary-600` | `#1D4ED8` | Hover/pressed primary |
| `--color-primary-50` | `#DBEAFE` | Selected conversation row, sent bubble tint |
| `--color-success-500` | `#16A34A` | Delivered/read success, online state |
| `--color-warning-500` | `#D97706` | Reconnecting, weak network |
| `--color-error-500` | `#DC2626` | Failed send, auth errors |
| `--color-error-50` | `#FEE2E2` | Error background |
| `--color-overlay` | `rgba(15, 23, 42, 0.52)` | Modal and call overlay |

Dark mode structure:

| Token | Value |
| --- | --- |
| `--color-bg-app-dark` | `#0B1220` |
| `--color-bg-surface-dark` | `#111827` |
| `--color-bg-surface-muted-dark` | `#172033` |
| `--color-border-soft-dark` | `#243041` |
| `--color-text-primary-dark` | `#F8FAFC` |
| `--color-text-secondary-dark` | `#CBD5E1` |
| `--color-text-tertiary-dark` | `#94A3B8` |
| `--color-primary-400-dark` | `#60A5FA` |
| `--color-primary-900-dark` | `#102A56` |

Status logic:
- Online dot: `success-500`
- Away dot: `warning-500`
- Offline dot: neutral border color
- Failed state: `error-500` text plus `error-50` background

### 2.2 Typography

Type family:
- Primary: Inter
- Fallback: `ui-sans-serif, system-ui, sans-serif`

Type scale:

| Token | Size / Line Height / Weight | Usage |
| --- | --- | --- |
| `display-sm` | `32 / 40 / 700` | Auth heading desktop |
| `title-lg` | `24 / 32 / 700` | Page titles |
| `title-md` | `20 / 28 / 650` | Conversation title, section titles |
| `title-sm` | `18 / 24 / 650` | Settings group titles |
| `body-lg` | `16 / 24 / 500` | Main form labels and body |
| `body-md` | `14 / 20 / 500` | Default UI text |
| `body-sm` | `13 / 18 / 500` | Metadata, previews |
| `caption` | `12 / 16 / 500` | Timestamps, chips, status |

Text rules:
- Conversation names: semibold, one line max, truncate.
- Message body: `body-md`, 65-72 characters per line max.
- Timestamps and helper text: `caption`.
- Avoid more than three font weights on one screen.

### 2.3 Spacing, Radius, Shadows

Spacing scale:
- `4, 8, 12, 16, 24, 32, 40, 48, 64`
- Base grid: 8px

Radius scale:
- `8` for fields, chips, badges
- `12` for buttons and panels
- `16` for message bubbles, modals, and call controls
- `999` for avatar rings, pills, and floating buttons

Shadow scale:
- `shadow-xs`: `0 1px 2px rgba(15, 23, 42, 0.06)`
- `shadow-sm`: `0 8px 20px rgba(15, 23, 42, 0.08)`
- `shadow-md`: `0 16px 32px rgba(15, 23, 42, 0.12)` for modals only

### 2.4 Motion

Motion tokens:
- `fast`: `150ms ease-out`
- `standard`: `200ms ease-out`
- `slow`: `240ms ease-out`

Approved motion:
- Sidebar and modal entrance: 16px translate + fade
- Message appearance: 8px upward fade on new message
- Typing indicator: looping dot pulse
- Send button feedback: quick scale to `0.98` on press

Do not use:
- Bounce animations
- Long spring transitions
- Background parallax

## 3. Layout Structure

### 3.1 Breakpoints

| Breakpoint | Width | Behavior |
| --- | --- | --- |
| Mobile | `360-767` | One panel at a time, full-screen thread or full-screen inbox |
| Tablet | `768-1279` | Narrow conversation rail plus thread, overlays for settings/profile |
| Desktop | `1280-1440+` | Persistent sidebar plus thread, roomy composer and call surfaces |

### 3.2 App Shell

Desktop layout:
- Root frame: `1440 x 1024`
- Two-column grid: `320px sidebar | minmax(0, 1fr) chat pane`
- Sidebar has fixed width, full height, vertical auto layout
- Thread pane has top bar, scrollable message region, sticky composer

Tablet layout:
- Root frame: `1024 x 900`
- Left rail: `88px` icon rail plus `280px` collapsible list drawer
- Thread remains primary reading surface

Mobile layout:
- Root frame: `390 x 844`
- Screen A: inbox list
- Screen B: active conversation
- Screen C: search overlay / settings / profile as push screens or bottom sheets

### 3.3 Surface Strategy

- Sidebar uses plain surface with one right divider.
- Thread area stays cardless.
- Composer uses top border and subtle background tint instead of a floating card.
- Settings and profile can use contained sections because they are form-oriented.

## 4. Component System

### 4.1 Buttons

Variants:
- `Button/Primary`
- `Button/Secondary`
- `Button/Ghost`
- `Button/Danger`
- `Button/Icon`
- `Button/Fab`

Sizing:
- `sm`: 36px height
- `md`: 44px height
- `lg`: 48px height

States:
- Default
- Hover
- Pressed
- Focus visible
- Disabled
- Loading with inline spinner

Rules:
- Primary buttons use solid primary fill with white label.
- Secondary buttons use neutral surface with border.
- Icon buttons are 40px or 44px square, radius 12.
- Send button becomes disabled when input is empty or a send with the same `clientTempId` is in flight.

Tailwind-style suggestion:
- Primary: `h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300`
- Secondary: `h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50`

### 4.2 Inputs

Variants:
- `Input/Text`
- `Input/Password`
- `Input/Search`
- `Input/TextareaComposer`

States:
- Rest
- Hover
- Focus
- Filled
- Error
- Disabled
- Loading

Rules:
- Input height 48px for forms, 40px for search.
- Inline error text sits 8px below the field.
- Search input includes leading icon and clear button.
- Composer input grows from one line to five lines max before internal scroll.

### 4.3 Avatars

Sizes:
- `xs 24`
- `sm 32`
- `md 40`
- `lg 56`
- `xl 88`

Variants:
- Image
- Initials fallback
- Presence badge

Rules:
- Presence badge anchors bottom-right.
- Group avatar can use stacked dual avatars at 24 or 32.

### 4.4 Conversation List Item

Structure:
- Avatar
- Main text column with title and preview
- Meta column with time and unread badge

States:
- Default
- Hover
- Active
- Unread
- Typing
- Muted visual placeholder if needed later

Rules:
- Row height 72px desktop, 68px mobile.
- Preview line truncates to one line.
- Typing state replaces preview text with accent-colored "typing..." copy.
- Unread badge is 20px min width pill.

### 4.5 Message Bubble

Variants:
- `Message/Incoming/Text`
- `Message/Outgoing/Text`
- `Message/Incoming/Image`
- `Message/Outgoing/Image`
- `Message/File`
- `Message/Pending`
- `Message/Failed`
- `Message/System`

Structure:
- Bubble body
- Optional media/file preview
- Meta row with timestamp and status

Rules:
- Max width: `78%` on mobile, `64%` on desktop.
- Outgoing bubble uses `primary-50` background and aligns right.
- Incoming bubble uses `surface-muted` background and aligns left.
- Adjacent messages from same sender within 2 minutes reduce top gap from 12px to 4px.
- Pending bubble shows `85%` opacity and mini spinner.
- Failed bubble shows error tint and a trailing `Retry` action.

Delivery/read icon logic:
- Sent by me, not delivered to peer: single check neutral
- Delivered: double check neutral
- Read: double check success or primary tint

### 4.6 Top Bar

Structure:
- Back button on mobile
- Conversation avatar
- Name and live status stack
- Action cluster: audio call, video call, more menu

Status copy:
- Online
- Last seen 2m ago
- Typing...
- Reconnecting...

### 4.7 Composer

Structure:
- Attachment button
- Multi-line text input
- Emoji button
- Send button

Rules:
- Sticky to bottom of viewport
- Respects mobile safe-area inset
- Keeps typed draft during connection loss
- Send button disabled during duplicate in-flight send
- Attachment button opens action sheet on mobile and dropdown on desktop

### 4.8 Overlays and Support Components

Need these reusable pieces:
- `Banner/InlineNetwork`
- `Toast/Success`
- `Toast/Error`
- `Dropdown/Menu`
- `Modal/Confirm`
- `Sheet/Mobile`
- `Skeleton/ConversationRow`
- `Skeleton/MessageBubble`
- `EmptyState/Inbox`
- `EmptyState/Search`
- `EmptyState/NoSelection`

## 5. Screen-by-Screen Spec

### 5.1 Auth - Login

Frame names:
- `Auth/Login/Desktop`
- `Auth/Login/Mobile`

Desktop layout:
- Split canvas `42 / 58`
- Left side is a full-height brand panel with app name, short utility headline, and a soft abstract chat pattern made of flat message bars
- Right side is a max-width `420px` form column centered vertically

Content order:
1. Wordmark and product label
2. Title: `Welcome back`
3. Support text: `Sign in to pick up where your conversations left off.`
4. `Continue with Google` button, full width, secondary elevated style
5. Divider with `or continue with email`
6. Email input
7. Password input
8. `Forgot password?` text link aligned right
9. Primary sign-in button
10. Footer copy: `Don't have an account? Sign up`

States:
- Loading: disable all fields and swap button label to `Signing in...`
- Error: top inline banner plus field-level error if credentials format is invalid
- Empty: default state
- Success: button swaps to `Redirecting...`, progress indicator appears for 800-1200ms max

Mobile behavior:
- Remove left brand panel
- Keep form top-aligned with 24px top padding
- Preserve Google button above email form
- Put legal/support links below the CTA, not beside fields

### 5.2 Auth - Signup

Frame names:
- `Auth/Signup/Desktop`
- `Auth/Signup/Mobile`

Layout:
- Mirrors login for consistency
- Form column max width `440px`

Fields:
- Full name
- Email
- Password
- Google signup button

Validation:
- Name: required
- Email: format check
- Password: minimum length hint and strength meter under field
- Inline errors appear without shifting the entire page; reserve error space under each field

Success state:
- Replace button label with `Account created`
- Show success banner: `Your account is ready. Redirecting to your inbox.`

Redirect pattern:
- If auth succeeds, transition directly into conversation list instead of a detached success page

### 5.3 Main Chat Application - Desktop

Frame names:
- `Chat/Desktop/Inbox`
- `Chat/Desktop/Thread`
- `Chat/Desktop/NoSelection`
- `Chat/Desktop/Reconnecting`

App shell:
- Sidebar width `320px`
- Thread pane fills remaining width
- Height uses full viewport with `100svh`

Sidebar structure:
1. Top header with current user avatar, name, and profile/settings actions
2. Search field
3. Conversation list with custom scrollbar
4. Bottom utility row on desktop only if needed for profile/settings shortcuts

Conversation row anatomy:
- Left: `40px` avatar
- Center: name, preview, typing state
- Right: timestamp, unread badge, pin space for future actions

Thread top bar:
- Conversation avatar + title
- Presence line below title
- Right-side actions for audio call, video call, more actions

Message region:
- Scrollable vertical column
- 16px horizontal padding mobile, 24px desktop
- Message day separators as subtle centered labels
- New message divider appears only when returning to unread history

Composer:
- 16px padding desktop, 12px mobile
- Attachment icon, composer field, emoji, send
- Send button visually prominent only when there is content

No selection state:
- Desktop only
- Centered illustration made from flat message shapes
- Heading: `Choose a conversation`
- Body: `Your messages, files, and live updates stay here.`

### 5.4 Sidebar Features

Search:
- Sticky at top below sidebar header
- Search placeholder: `Search people or chats`
- Typing a query replaces the conversation list with result groups

Result groups:
- `Conversations`
- `People`

Search row behavior:
- Highlight matching text
- Clicking an existing conversation opens it
- Clicking a user without an existing conversation starts one and shows a temporary row state: `Starting chat...`

Scroll behavior:
- Sidebar content scrolls independently from the thread
- Search field and header stay pinned
- On large desktop screens, show thin custom scrollbar only on hover

Icons:
- Profile icon opens profile page or side sheet
- Settings icon opens settings page or side sheet

### 5.5 Main Chat Application - Mobile

Frame names:
- `Chat/Mobile/Inbox`
- `Chat/Mobile/Thread`
- `Chat/Mobile/Search`
- `Chat/Mobile/Reconnecting`

Mobile inbox:
- Full-screen list
- Top area includes product title, user avatar, settings icon
- Search input under header
- FAB optional for future compose flow, not required for MVP

Mobile thread:
- Full-screen conversation
- Back button in top bar returns to inbox
- Sticky composer above keyboard
- Messages animate in with very small fade

Keyboard handling:
- Use safe-area padding
- Composer stays visible above keyboard
- Thread list reduces height rather than allowing the keyboard to cover the input

### 5.6 Profile Page

Frame names:
- `Profile/Desktop`
- `Profile/Mobile`

Layout:
- Desktop: two-column form with left profile preview and right editable fields
- Mobile: stacked sections with sticky save bar when there are unsaved changes

Sections:
1. Avatar block with upload control
2. Public info: name, email, bio
3. Presence preview: online/offline/away chip preview
4. Action row: save, cancel

Avatar interaction:
- Hover desktop shows `Change photo`
- Mobile uses bottom sheet with `Upload new`, `Remove`, `Cancel`
- Uploading shows circular progress ring around avatar

Unsaved state:
- Sticky footer or top inline bar: `You have unsaved changes`

### 5.7 Settings Page

Frame names:
- `Settings/Desktop`
- `Settings/Mobile`

Structure:
- Grouped settings sections separated by 24px spacing
- Each section uses plain surface with 16px internal padding and soft border

Sections:
1. Account
2. Appearance
3. Security
4. Notifications
5. Session

Required controls:
- Theme toggle: `Light / Dark / System`
- Change password fields: current, new, confirm
- Notification toggles:
  - Message sound
  - Desktop notifications
  - Show message preview
- Logout button: danger style

Interaction:
- Save bar appears only when a section has changed fields
- Password section validates inline and shows strength hint

### 5.8 User Search Flow

Frame names:
- `Search/Idle`
- `Search/Loading`
- `Search/Results`
- `Search/Empty`
- `Search/Error`

Behavior:
- Idle: helper text `Search by name or email`
- Loading: 5 skeleton result rows
- Results: avatar, display name, email, presence state, trailing action label `Message`
- Empty: icon + `No people found`
- Error: inline retry block with `Try again`

Open/create conversation:
- If a conversation exists, route into thread immediately
- If not, optimistically create row and navigate once created
- If creation fails, keep results visible and show inline error toast

### 5.9 Audio Call Page

Frame names:
- `Call/Audio/Desktop`
- `Call/Audio/Mobile`

Layout:
- Fullscreen dimmed surface
- Center stack:
  - large avatar `96-120px`
  - participant name
  - connection state / timer
- Bottom control dock:
  - speaker
  - mute
  - end call

States:
- Connecting: animated ring around avatar
- Connected: show timer
- Reconnecting: warning pill above controls
- Failed: error illustration with `Retry` and `Back to chat`

Rules:
- End call button is always red and central
- Control dock uses blurred or tinted surface with large touch targets

### 5.10 Video Call Page

Frame names:
- `Call/Video/Desktop`
- `Call/Video/Mobile`

Layout:
- Remote video occupies full canvas
- Self-view picture-in-picture card in top-right desktop, top-left mobile if it avoids system UI
- Bottom control dock:
  - mute
  - camera
  - end call
  - overflow

States:
- Connecting: blurred placeholder with spinner
- Permission denied: centered permission guidance block
- Camera off: avatar tile replaces self-view
- Failed: overlay panel with `Reconnect` and `Return to chat`

Mobile specifics:
- Controls stay within thumb reach
- Self-view can collapse to a circular avatar chip when space is tight

## 6. Critical Behavior States

### 6.1 Loading

Use skeletons, not spinners, for content regions:
- 6 conversation row skeletons in inbox
- 8 mixed message skeletons in thread
- Search result skeletons in search view
- Form button spinner for auth/settings submits

### 6.2 Empty States

Need explicit empty states for:
- No conversations yet
- No search results
- No conversation selected on desktop
- No notifications preference configured if needed later

Copy should be short and utility-first.

### 6.3 Error States

Required error patterns:
- Auth failure banner on login/signup
- Message failed inline with retry
- Search failed inline block
- Network loss banner in thread and inbox
- Call failed modal overlay

### 6.4 Typing Indicator

Placement:
- Under conversation name in top bar for active thread
- In conversation preview row for inactive thread

Style:
- Accent text plus 3 animated dots
- Max one line, disappears after stop timeout

### 6.5 Message Sending

Pending state:
- Bubble appears immediately
- Reduced opacity
- Mini spinner beside time

Failure state:
- Bubble tint shifts toward `error-50`
- Status line reads `Failed to send`
- Small `Retry` button appears below or beside the bubble

Duplicate prevention:
- Keep send button disabled until the current payload with the same draft hash or `clientTempId` resolves
- Do not clear draft until the message is locally inserted into the thread

### 6.6 Online / Offline / Last Seen

Rules:
- Active thread shows `Online`, `Away`, or `Last seen`
- Conversation list rows can show a tiny status dot only for direct messages
- Offline should never use error red

### 6.7 Reconnecting

Thread behavior:
- Sticky warning banner below top bar
- Keep draft text in composer
- Disable attachment upload and optionally disable send after a short timeout
- Show `Trying again...` copy with spinner

Inbox behavior:
- Small top banner, not a blocking modal

Recovery:
- Remove banner with fade when socket reconnects
- Run message sync before clearing all warning markers

## 7. Browser and Real-Time Behavior

### 7.1 Scroll and Message History

Latest-message behavior:
- Auto-scroll only if the user is already at or near the bottom
- If the user has scrolled up, show a floating `Jump to latest` button

Infinite scroll:
- Use top sentinel loader for older messages
- Preserve scroll position after prepending older messages

Unread behavior:
- When opening a conversation with unread messages, anchor near the first unread message if available

### 7.2 Network Loss

UI reaction timeline:
1. Immediate connection chip changes to `Reconnecting`
2. Thread banner appears
3. Pending message bubbles remain visible
4. Once back online, request sync and update pending/delivery states

### 7.3 Responsive Breakpoint Adaptation

Desktop:
- Persistent sidebar
- Wide composer
- Hover states enabled

Tablet:
- Sidebar can collapse to icon rail
- Settings/profile appear as side sheets

Mobile:
- One primary surface at a time
- Larger touch targets
- Fixed bottom composer with safe-area support

### 7.4 Interaction Details

Hover:
- Desktop only for list rows, buttons, and avatar actions

Pressed:
- Buttons scale to `0.98`
- List rows darken by one neutral step

Focus:
- 2px primary ring on fields and actionable controls

Transitions:
- Screen changes: 200ms
- Sheet entrance: 220ms
- Banner dismissal: 160ms

## 8. Backend-Aligned UI Contract

This is the recommended frontend behavior against the current backend shape in this repo.

REST surfaces already visible:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `GET /conversations`
- `POST /conversations`
- `POST /messages`
- `GET /messages/:conversationId`

Socket events already visible:
- `join_conversation`
- `leave_conversation`
- `send_message`
- `receive_message`
- `messages_delivered`
- `messages_delivered_update`
- `messages_read`
- `messages_read_update`
- `sync_messages`
- `typing_start`
- `typing_stop`
- `user_typing`
- `user_stopped_typing`
- `user_online`
- `user_offline`

Frontend mapping:
- Use conversation list `unread.hasUnread` to render unread badge visibility.
- Use `lastMessage` from the conversation list to populate preview text and timestamp.
- On thread open, join the conversation room before typing or delivery/read updates.
- When a sent message is acknowledged, replace pending state with persisted data by `clientTempId`.
- On reconnect, run `sync_messages` and then refresh the thread indicators before clearing reconnect UI.

Assumptions to keep visible during implementation:
- Google login button is designed as a first-class auth CTA because the data model already supports `provider: "google"`, even if route wiring is still pending.
- User search UI is included as a required product flow even though a search route is not visible in this repo snapshot.
- Audio/video call pages are UI-complete but will need signaling/media services behind them.

## 9. Suggested Figma File Structure

Pages:
1. `00 Cover`
2. `01 Foundations`
3. `02 Components`
4. `03 Patterns`
5. `04 Screens - Light`
6. `05 Screens - Dark`
7. `06 Prototypes`
8. `07 Handoff`

Foundation frames:
- `Color / Light`
- `Color / Dark`
- `Type / Scale`
- `Spacing / 8pt`
- `Radius / Shadow / Motion`

Component frames:
- `Button`
- `Input`
- `Avatar`
- `Conversation Item`
- `Message Bubble`
- `Top Bar`
- `Composer`
- `Banner`
- `Modal`
- `Dropdown`
- `Empty State`
- `Skeleton`

Screen frames:
- `Auth / Login / Desktop`
- `Auth / Login / Mobile`
- `Auth / Signup / Desktop`
- `Auth / Signup / Mobile`
- `Chat / Inbox / Desktop`
- `Chat / Thread / Desktop`
- `Chat / No Selection / Desktop`
- `Chat / Inbox / Mobile`
- `Chat / Thread / Mobile`
- `Profile / Desktop`
- `Profile / Mobile`
- `Settings / Desktop`
- `Settings / Mobile`
- `Search / Idle`
- `Search / Results`
- `Search / Empty`
- `Call / Audio / Desktop`
- `Call / Audio / Mobile`
- `Call / Video / Desktop`
- `Call / Video / Mobile`

Prototype flows:
- `Auth success`
- `Open conversation`
- `Search and start conversation`
- `Send message`
- `Message failed and retry`
- `Network loss and reconnect`
- `Audio call flow`
- `Video call flow`

Auto layout recommendations:
- Every component frame should use auto layout.
- Thread screens should use nested auto layout with one scrollable message region.
- Keep message bubble variants as components with text properties, not detached frames.

## 10. Dev Handoff Naming and Tailwind-Oriented Suggestions

Suggested component names:
- `AppShell`
- `SidebarHeader`
- `ConversationSearch`
- `ConversationList`
- `ConversationListItem`
- `ChatTopBar`
- `MessageList`
- `MessageBubble`
- `TypingIndicator`
- `MessageComposer`
- `ProfileForm`
- `SettingsSection`
- `SearchResultsList`
- `AudioCallScreen`
- `VideoCallScreen`

Suggested CSS variable mapping:

```css
:root {
  --bg-app: #f8fafc;
  --bg-surface: #ffffff;
  --bg-muted: #f1f5f9;
  --border-soft: #e2e8f0;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #64748b;
  --primary: #2563eb;
  --primary-strong: #1d4ed8;
  --primary-soft: #dbeafe;
  --success: #16a34a;
  --warning: #d97706;
  --error: #dc2626;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}
```

Suggested shell classes:

```txt
App shell: h-svh bg-slate-50 text-slate-900 md:grid md:grid-cols-[320px_minmax(0,1fr)]
Sidebar: border-r border-slate-200 bg-white
Thread: flex min-h-0 flex-col bg-slate-50
Top bar: flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6
Composer: sticky bottom-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur supports-[padding:max(0px)]:pb-[max(12px,env(safe-area-inset-bottom))]
Outgoing bubble: ml-auto rounded-2xl rounded-br-md bg-blue-50 px-3 py-2 text-slate-900
Incoming bubble: mr-auto rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-slate-900
Unread badge: inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white
Network banner: border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800
```

## 11. Implementation Checklist

Before frontend build starts, confirm:
- Light mode tokens are created first, then mirrored into dark mode.
- All reusable components exist before full screens are assembled.
- Auth, inbox, thread, profile, settings, search, and call flows each have loading, empty, error, and success states.
- Message bubble variants include pending, failed, delivered, and read.
- Mobile thread behavior is tested with keyboard open.
- Reconnect banner and sync recovery are prototyped, not left implicit.

If this system is recreated in Figma first, build it in this order:
1. Foundations
2. Components
3. Auth screens
4. Inbox and thread
5. Search flow
6. Profile and settings
7. Audio/video call screens
8. Prototype links and edge states
