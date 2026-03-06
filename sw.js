importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// ==========================================
// 🌟 1. キャッシュのバージョン管理（アップデート時はここを変更！）
// ==========================================
const CACHE_VERSION = 'app-v1.0.2'; // 👈 今後アップデートする際はこの文字を適当に変えるだけでOKです（例: v1.0.1）

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

// ==========================================
// 🌟 2. サービスワーカーの即時更新＆お掃除機能（追加部分）
// ==========================================

// インストール時：新しいバージョンが見つかったら、即座に待機状態をスキップする
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// アクティブ時：古いバージョンのキャッシュが残っていればすべて削除し、即座にコントロールを奪う
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // 現在のバージョン名と違うキャッシュはすべて破棄
                    if (cacheName !== CACHE_VERSION) {
                        console.log('古いキャッシュを削除しました:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // すぐに新しいサービスワーカーを適用
    );
});

// ==========================================
// 3. プッシュ通知の処理（既存のまま）
// ==========================================

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


