importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCWy_BjB9tr02viCSfAx93qeJyX4G0e2iw",
  authDomain: "keep-under-control.firebaseapp.com",
  projectId: "keep-under-control",
  storageBucket: "keep-under-control.firebasestorage.app",
  messagingSenderId: "999632394190",
  appId: "1:999632394190:web:085efbde0239f098c27d9f"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ■ 修正：重複通知を防ぐため、バックグラウンド受信時の手動表示を削除しました。
// Firebaseが自動で通知を表示してくれる機能に任せます。

messaging.onBackgroundMessage((payload) => {
  console.log('バックグラウンド通知を受信:', payload);
  // ここにあった showNotification を削除しました
});

// 通知をタップした時の動作（アプリを開く）
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // タップされた通知にURLデータが含まれていればそれを使う、なければトップページ
    // ※自動通知の場合、payload.data の内容は event.notification.data に入らないことがあるため
    // 固定URLでアプリを開く安全策をとります。
    const targetUrl = 'https://ymyoupre-sys.github.io/keep-under-control/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // すでに開いているタブがあればフォーカス
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('keep-under-control') && 'focus' in client) {
                    return client.focus();
                }
            }
            // 開いてなければ新規で開く
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
