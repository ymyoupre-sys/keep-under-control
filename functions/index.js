// functions/index.js

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// ■ チャット通知 — 🛡️ 修正済み：宛先判定ロジックを修正
exports.sendChatNotification = onDocumentCreated("chats/{chatRoomId}/messages/{messageId}", async (event) => {
    const newMessage = event.data.data();
    const chatRoomId = event.params.chatRoomId; 
    
    if (!newMessage) return;

    const parts = chatRoomId.split('_');
    const groupId = parts[0];

    // 🛡️ 通知を送る相手のリストを組み立てる
    let recipientIds = [];

    if (parts[1] === 'ALL') {
        // グループ全体チャット → グループ全員（送信者以外）に通知
        const snapshot = await db.collection("users")
            .where("group", "==", groupId)
            .get();
        snapshot.forEach(doc => {
            if (doc.id !== newMessage.senderId) {
                recipientIds.push(doc.id);
            }
        });
    } else {
        // 🛡️ 1対1チャット → ルームIDから送信者以外のIDを取り出す
        // ルームID例: E_u009_u010 → ['E', 'u009', 'u010'] → 送信者でないほうが宛先
        const userIds = parts.slice(1);
        recipientIds = userIds.filter(id => id !== newMessage.senderId);
    }

    if (recipientIds.length === 0) {
        console.log("No recipients found for room:", chatRoomId);
        return;
    }

    // 各受信者に通知を送信
    for (const recipientId of recipientIds) {
        const userDoc = await db.collection("users").doc(recipientId).get();
        if (!userDoc.exists) {
            console.log("User not found:", recipientId);
            continue;
        }
        const fcmToken = userDoc.data()?.fcmToken;

        if (!fcmToken) {
            console.log("No FCM Token for user:", recipientId);
            continue;
        }

        const message = {
            notification: {
                title: newMessage.senderName, 
                body: newMessage.text || "画像が送信されました",
            },
            data: {
                url: `https://ymyoupre-sys.github.io/keep-under-control/`, 
                chatId: chatRoomId,
                senderId: newMessage.senderId || "",
                tab: "chat"
            },
            token: fcmToken
        };

        try {
            await getMessaging().send(message);
            console.log("Chat Notification sent to:", recipientId);
        } catch (error) {
            console.error("Error sending notification to", recipientId, ":", error);
            // 🛡️ 無効なトークンを自動でDBから削除する
            if (error.code === 'messaging/registration-token-not-registered' ||
                error.code === 'messaging/invalid-registration-token') {
                await db.collection("users").doc(recipientId).update({ fcmToken: "" });
                console.log("Invalid token removed for:", recipientId);
            }
        }
    }
});


// ■ 申請/指示の通知 (新規作成)
exports.sendApplicationNotification = onDocumentCreated("applications/{appId}", async (event) => {
    const appData = event.data.data();
    if (!appData) return;

    let recipientQuery = null;
    
    if (appData.role === 'leader' || appData.type === 'instruction') {
         recipientQuery = db.collection("users")
             .where("group", "==", appData.groupId)
             .where("role", "==", "member");
    } else {
         recipientQuery = db.collection("users")
             .where("group", "==", appData.groupId)
             .where("role", "==", "leader");
    }

    const snapshot = await recipientQuery.get();
    if (snapshot.empty) return;

    const tokens = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        if (doc.id !== appData.userId && d.fcmToken) {
            tokens.push(d.fcmToken);
        }
    });

    if (tokens.length === 0) return;

    const messagePayload = {
        notification: {
            title: "新しい連絡・申請",
            body: `${appData.userName}さんが「${appData.title}」を作成しました。`,
        },
        data: {
            url: `https://ymyoupre-sys.github.io/keep-under-control/`,
            tab: "inbox"
        }
    };

    try {
        await getMessaging().sendEachForMulticast({
            ...messagePayload,
            tokens: tokens
        });
        console.log("Application Notification sent to", tokens.length, "devices");
    } catch (error) {
        console.error("Error sending app notification:", error);
    }
});


// ■ 申請ステータス変更の通知
exports.sendStatusNotification = onDocumentUpdated("applications/{appId}", async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();

    if (newData.status === oldData.status) return;

    const applicantId = newData.userId;
    const userDoc = await db.collection("users").doc(applicantId).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if (!fcmToken) return;

    let bodyText = "";
    if (newData.status === 'approved') bodyText = "申請が承認されました。";
    if (newData.status === 'rejected') bodyText = "申請が却下されました。";
    if (newData.status === 'pending') bodyText = "ステータスが更新されました。";

    const message = {
        notification: {
            title: "申請結果のお知らせ",
            body: bodyText
        },
        token: fcmToken,
        data: {
             url: `https://ymyoupre-sys.github.io/keep-under-control/`,
             tab: "inbox"
        }
    };

    try {
        await getMessaging().send(message);
        console.log("Status Notification sent to:", applicantId);
    } catch (error) {
        console.error("Error sending status notification:", error);
        // 🛡️ 無効なトークンを自動でDBから削除する
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            await db.collection("users").doc(applicantId).update({ fcmToken: "" });
            console.log("Invalid token removed for:", applicantId);
        }
    }
});