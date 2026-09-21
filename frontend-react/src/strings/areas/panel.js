// Worker 4 (2026-09-21): notifications side panel strings.
//
// The topbar bell opens the panel; the push enable/disable switch lives
// inside it (the switch calls the store's toggleNotify — the enable logic
// itself is owned by Worker 1 and is not reimplemented here). Every key
// below is sentence case, short enough to read on a lock-screen glance.
export default {
  en: {
    panelClose: 'Close',
    panelBellUnread: '{n} unread notifications',
    panelUnreadCount: '{n} unread',
    panelPushTitle: 'Alert push',
    panelPushHint: 'Get warnings even when the app is closed',
    panelPushOn: 'On',
    panelPushOff: 'Off',
    panelOpenAlert: 'Open alert',
    // Filter chips + clear control (Crew E, Phase 1): the panel owns the
    // list, so it owns the filter; clearing dismisses on this device only.
    panelFilterLabel: 'Filter',
    panelFilterAll: 'All',
    panelFilterUnread: 'Unread',
    panelFilterAlerts: 'Alerts',
    panelFilterInfo: 'Info',
    panelClear: 'Clear all',
    panelCleared: 'Notifications cleared',
    // Permission-denied guidance links to Settings (Crew G owns the panel
    // itself; this only navigates there).
    panelOpenSettings: 'Open settings',
  },
  hi: {
    panelClose: 'बंद करें',
    panelBellUnread: '{n} अपठित सूचनाएँ',
    panelUnreadCount: '{n} अपठित',
    panelPushTitle: 'अलर्ट पुश',
    panelPushHint: 'ऐप बंद होने पर भी चेतावनी पाएँ',
    panelPushOn: 'चालू',
    panelPushOff: 'बंद',
    panelOpenAlert: 'अलर्ट खोलें',
    panelFilterLabel: 'फ़िल्टर',
    panelFilterAll: 'सभी',
    panelFilterUnread: 'अपठित',
    panelFilterAlerts: 'अलर्ट',
    panelFilterInfo: 'जानकारी',
    panelClear: 'सभी साफ़ करें',
    panelCleared: 'सूचनाएँ साफ़ हो गईं',
    panelOpenSettings: 'सेटिंग खोलें',
  },
  te: {
    panelClose: 'మూసివేయండి',
    panelBellUnread: '{n} చదవని నోటిఫికేషన్లు',
    panelUnreadCount: '{n} చదవని',
    panelPushTitle: 'అలర్ట్ పుష్',
    panelPushHint: 'యాప్ మూసి ఉన్నా హెచ్చరికలు పొందండి',
    panelPushOn: 'ఆన్',
    panelPushOff: 'ఆఫ్',
    panelOpenAlert: 'అలర్ట్ తెరవండి',
    panelFilterLabel: 'ఫిల్టర్',
    panelFilterAll: 'అన్నీ',
    panelFilterUnread: 'చదవనివి',
    panelFilterAlerts: 'అలర్ట్‌లు',
    panelFilterInfo: 'సమాచారం',
    panelClear: 'అన్నీ తొలగించు',
    panelCleared: 'నోటిఫికేషన్లు తొలగించబడ్డాయి',
    panelOpenSettings: 'సెట్టింగ్‌లు తెరవండి',
  },
};
