importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Your web app's Firebase configuration
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

// バックグラウンドで通知を受信した時の処理
messaging.onBackgroundMessage((payload) => {
  console.log('バックグラウンド通知を受信:', payload);// sw.js
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

// バックグラウンド通知の受信処理
messaging.onBackgroundMessage((payload) => {
  console.log('バックグラウンド通知を受信:', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: './images/icon.png', // アイコンパスを修正
    // タップしたときにアプリを開くための設定
    data: {
        click_action: payload.notification.click_action || 'https://ymyoupre-sys.github.io/keep-under-control/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 通知タップ時の動作
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // すでに開いているタブがあればフォーカス、なければ新規で開く
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('keep-under-control') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('https://ymyoupre-sys.github.io/keep-under-control/');
            }
        })
    );
});
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png' // アイコン画像があれば指定
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
