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

let badgeCount = 0; // アプリアイコンの数字バッジ用

messaging.onBackgroundMessage((payload) => {
  console.log('バックグラウンド通知を受信:', payload);
});

// ① プッシュ通知を受け取った時にアイコンバッジの数字を増やす
self.addEventListener('push', (event) => {
    badgeCount++;
    if (navigator.setAppBadge) {
        navigator.setAppBadge(badgeCount).catch(console.error);
    }
});

// ② 通知をタップした時の動作（アプリを開く＆数字をリセット＆該当タブへジャンプ）
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // バッジをリセット
    badgeCount = 0;
    if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch(console.error);
    }
    
    // 届いた通知データから開くべきタブを判別（データがなければ受信箱へ）
    // Firebaseの仕様上、データは event.notification.data.FCM_MSG.data 等に入る場合があります
    let targetTab = 'inbox';
    const payloadData = event.notification.data?.FCM_MSG?.data || event.notification.data;
    if (payloadData && payloadData.tab) {
        targetTab = payloadData.tab;
    }
    
    // ジャンプ先のURLを生成
    const targetUrl = `https://ymyoupre-sys.github.io/keep-under-control/?tab=${targetTab}`;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // すでに開いているタブがあればそこにフォーカスして画面遷移
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('keep-under-control') && 'focus' in client) {
                    return client.focus().then(c => c.navigate(targetUrl));
                }
            }
            // 開いてなければ新規で指定タブを開く
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
