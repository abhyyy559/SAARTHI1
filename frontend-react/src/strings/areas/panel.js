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
  },
};
