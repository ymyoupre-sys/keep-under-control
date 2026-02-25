// functions/index.js

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// ■ チャット通知
exports.sendChatNotification = onDocumentCreated("chats/{chatRoomId}/messages/{messageId}", async (event) => {
    const newMessage = event.data.data();
    const chatRoomId = event.params.chatRoomId; 
    
    if (!newMessage) return;

    const [groupId, memberId] = chatRoomId.split('_');

    let recipientId = null;

    if (newMessage.senderId === memberId) {
        const usersRef = db.collection("users");
        // 👇【修正1】検索対象のフィールドを "groupId" から "group" に変更
        const snapshot = await usersRef
            .where("group", "==", groupId) 
            .where("role", "==", "leader")
            .get();
        
        if (!snapshot.empty) {
            recipientId = snapshot.docs[0].id;
        }
    } else {
        recipientId = memberId;
    }

    if (!recipientId) {
        console.log("Recipient not found");
        return;
    }

    const userDoc = await db.collection("users").doc(recipientId).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if (!fcmToken) {
        console.log("No FCM Token for user:", recipientId);
        return;
    }

    const message = {
        notification: {
            title: newMessage.senderName, 
            body: newMessage.text || "画像が送信されました",
        },
        data: {
            url: `https://ymyoupre-sys.github.io/keep-under-control/`, 
            chatId: chatRoomId
        },
        token: fcmToken
    };

    try {
        await getMessaging().send(message);
        console.log("Chat Notification sent to:", recipientId);
    } catch (error) {
        console.error("Error sending notification:", error);
        // 🛡️ 無効なトークンを自動でDBから削除する（アプリ削除済みユーザー等）
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            await db.collection("users").doc(recipientId).update({ fcmToken: "" });
            console.log("Invalid token removed for:", recipientId);
        }
    }
});


// ■ 申請/指示の通知 (新規作成)
exports.sendApplicationNotification = onDocumentCreated("applications/{appId}", async (event) => {
    const appData = event.data.data();
    if (!appData) return;

    let recipientQuery = null;
    
    if (appData.role === 'leader' || appData.type === 'instruction') {
         // 👇【修正2】検索対象のフィールドを "groupId" から "group" に変更
         recipientQuery = db.collection("users")
             .where("group", "==", appData.groupId)
             .where("role", "==", "member");
    } else {
         // 👇【修正3】検索対象のフィールドを "groupId" から "group" に変更
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
            url: `https://ymyoupre-sys.github.io/keep-under-control/`
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
             url: `https://ymyoupre-sys.github.io/keep-under-control/`
        }
    };

    try {
        await getMessaging().send(message);
        console.log("Status Notification sent to:", applicantId);
    } catch (error) {
        console.error("Error sending status notification:", error);
    }
});
