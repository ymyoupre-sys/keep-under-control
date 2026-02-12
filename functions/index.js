// functions/index.js

/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// ■ チャット通知
// chats/{chatRoomId}/messages/{messageId} に書き込みがあったら発火
exports.sendChatNotification = onDocumentCreated("chats/{chatRoomId}/messages/{messageId}", async (event) => {
    const newMessage = event.data.data();
    const chatRoomId = event.params.chatRoomId; // 例: "groupA_member1"
    
    // 自分のメッセージなら通知しない（念のため）
    if (!newMessage) return;

    // chatRoomId から グループID と メンバーID を抽出
    // 形式: [groupId]_[memberId]
    const [groupId, memberId] = chatRoomId.split('_');

    let recipientId = null;

    // 送信者がメンバーなら、宛先は「そのグループのリーダー」
    if (newMessage.senderId === memberId) {
        // グループのリーダーを探す
        const usersRef = db.collection("users");
        const snapshot = await usersRef
            .where("groupId", "==", groupId)
            .where("role", "==", "leader")
            .get();
        
        if (!snapshot.empty) {
            // リーダーは1人と仮定（複数いる場合はループ処理）
            recipientId = snapshot.docs[0].id;
        }
    } else {
        // 送信者がメンバーでなければ（＝リーダー）、宛先は「メンバー」
        recipientId = memberId;
    }

    if (!recipientId) {
        console.log("Recipient not found");
        return;
    }

    // 宛先のトークンを取得
    const userDoc = await db.collection("users").doc(recipientId).get();
    const fcmToken = userDoc.data()?.fcmToken;

    if (!fcmToken) {
        console.log("No FCM Token for user:", recipientId);
        return;
    }

    // 通知メッセージの作成
    const message = {
        notification: {
            title: newMessage.senderName, // 送信者名
            body: newMessage.text || "画像が送信されました",
        },
        data: {
            url: `https://ymyoupre-sys.github.io/keep-under-control/`, // タップ時の飛び先
            chatId: chatRoomId
        },
        token: fcmToken
    };

    // 送信
    try {
        await getMessaging().send(message);
        console.log("Chat Notification sent to:", recipientId);
    } catch (error) {
        console.error("Error sending notification:", error);
    }
});


// ■ 申請/指示の通知 (新規作成)
// applications/{appId} が作成されたら発火
exports.sendApplicationNotification = onDocumentCreated("applications/{appId}", async (event) => {
    const appData = event.data.data();
    if (!appData) return;

    // 誰に送るか？
    let recipientQuery = null;

    // メンバーが作成した申請 (type: request 等) -> リーダーへ通知
    // リーダーが作成した指示 (type: instruction 等) -> 宛先メンバーへ通知？
    // ※今回は簡易的に「作成者以外（上長/部下）」に送るロジックにします
    
    if (appData.role === 'leader' || appData.type === 'instruction') {
         // リーダーからの指示 -> 特定のメンバーへ？ 
         // アプリの仕様上、指示が「全員宛て」か「特定個人宛て」かによりますが、
         // ここでは「グループのメンバー全員」に送る例とします
         recipientQuery = db.collection("users")
             .where("groupId", "==", appData.groupId)
             .where("role", "==", "member");
    } else {
         // メンバーからの申請 -> リーダーへ
         recipientQuery = db.collection("users")
             .where("groupId", "==", appData.groupId)
             .where("role", "==", "leader");
    }

    const snapshot = await recipientQuery.get();
    if (snapshot.empty) return;

    const tokens = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        // 自分自身には送らない
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
        // マルチキャストの場合は tokens を使うため sendEachForMulticast を使用
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
// applications/{appId} が更新されたら発火
exports.sendStatusNotification = onDocumentUpdated("applications/{appId}", async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();

    // ステータスが変わった時だけ通知
    if (newData.status === oldData.status) return;

    // 申請者（作成者）に通知を送る
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
