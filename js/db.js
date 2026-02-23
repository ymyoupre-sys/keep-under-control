import { db, storage } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc, deleteDoc, getDoc, arrayUnion, arrayRemove, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const getRoomId = (groupId, id1, id2) => {
    // 👇 追加：対象が「ALL」の場合は、全体チャット専用の部屋を作る
    if (id1 === "ALL" || id2 === "ALL") return `${groupId}_ALL`;

    const sortedIds = [id1, id2].sort();
    return `${groupId}_${sortedIds[0]}_${sortedIds[1]}`;
};

export const DB = {
    // ユーザー名簿を削除する機能
    async deleteUserAccount(userId) {
        await deleteDoc(doc(db, "users", userId));
    },

    // 👇 追加：AuthのIDと、名簿のIDを結びつける証明書を作成する
    async createAuthBridge(authUid, userId, group) {
        if (!authUid || !userId) return;
        try {
            await setDoc(doc(db, "auth_bridge", authUid), {
                userId: userId,
                group: group || "未設定",
                updatedAt: serverTimestamp()
            }, { merge: true });

            // 🚨【重要】名簿（users）側に自分のUIDを刻印し、他人の乗っ取りをロックする！
            await updateDoc(doc(db, "users", userId), {
                authUid: authUid,
                updatedAt: serverTimestamp()
            });
        } catch (e) {
            console.error("Bridge Error:", e);
        }
    },

    async saveUserToken(user, token) {
        if (!user || !user.id) return;
        const userRef = doc(db, "users", user.id);
        const updateData = {
            name: user.name,
            role: user.role,
            group: user.group, 
            icon: user.icon || "👤",
            updatedAt: serverTimestamp()
        };
        if (token) updateData.fcmToken = token;
        await setDoc(userRef, updateData, { merge: true });
    },

    getChatRoomId(groupId, id1, id2) { return getRoomId(groupId, id1, id2); },

    subscribeChat(groupId, id1, id2, callback) {
        const safeGroup = groupId || "NONE";
        const chatRoomId = getRoomId(safeGroup, id1, id2);
        const q = query(collection(db, "chats", chatRoomId, "messages"), orderBy("createdAt", "asc"));
        return onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(messages);
        });
    },

    async uploadImage(base64String, folderName) {
        if (!base64String) return null;
        if (base64String.startsWith('http')) return base64String;
        
        const fileName = `${folderName}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
        const storageRef = ref(storage, fileName);
        await uploadString(storageRef, base64String, 'data_url');
        return await getDownloadURL(storageRef);
    },

    async sendMessage(groupId, id1, id2, sender, text, images = []) {
        const safeGroup = groupId || "NONE";
        const chatRoomId = getRoomId(safeGroup, id1, id2);
        
        const imageUrls = [];
        for (const imgBase64 of images) {
            const url = await this.uploadImage(imgBase64, `chats/${chatRoomId}`);
            if (url) imageUrls.push(url);
        }

        await addDoc(collection(db, "chats", chatRoomId, "messages"), {
            text: text, senderId: sender.id, senderName: sender.name, senderIcon: sender.icon || "👤",
            images: imageUrls, reactions: [], isEdited: false, createdAt: serverTimestamp()
        });
        const lastMsgText = text || (imageUrls.length > 0 ? '画像が送信されました' : '');
        await setDoc(doc(db, "chats", chatRoomId), { lastMessage: lastMsgText, updatedAt: serverTimestamp() }, { merge: true });
    },

    async updateMessage(groupId, id1, id2, messageId, newText) {
        const safeGroup = groupId || "NONE";
        const chatRoomId = getRoomId(safeGroup, id1, id2);
        await updateDoc(doc(db, "chats", chatRoomId, "messages", messageId), { text: newText, isEdited: true, updatedAt: serverTimestamp() });
    },

    async toggleReaction(groupId, id1, id2, messageId, userId) {
        const safeGroup = groupId || "NONE";
        const chatRoomId = getRoomId(safeGroup, id1, id2);
        const msgRef = doc(db, "chats", chatRoomId, "messages", messageId);
        const snap = await getDoc(msgRef);
        if(snap.exists()) {
            const data = snap.data();
            const reactions = data.reactions || [];
            if(reactions.includes(userId)) await updateDoc(msgRef, { reactions: arrayRemove(userId) });
            else await updateDoc(msgRef, { reactions: arrayUnion(userId) });
        }
    },

    subscribeApplications(groupId, callback) {
        const safeGroup = groupId || "NONE";
        const q = query(collection(db, "applications"), where("groupId", "==", safeGroup), orderBy("createdAt", "desc"));
        return onSnapshot(q, (snapshot) => {
            const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(apps);
        }, (error) => { console.error("Inbox Error:", error); callback([]); });
    },

    async submitForm(data) {
        const imageUrls = [];
        if (data.images && data.images.length > 0) {
            for (const imgBase64 of data.images) {
                const url = await this.uploadImage(imgBase64, `applications/${data.groupId}`);
                if (url) imageUrls.push(url);
            }
        }
        data.images = imageUrls; 

        const now = new Date();
        const formattedDate = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

        await addDoc(collection(db, "applications"), {
            ...data, 
            status: 'pending', 
            createdAt: serverTimestamp(), 
            updatedAt: serverTimestamp(), 
            createdDateStr: formattedDate // 👈 変更：時間入りの文字列を保存する
        });
    },
    
    async updateStatus(docId, status, comment = '', updaterId) {
        await updateDoc(doc(db, "applications", docId), {
            status: status, resultComment: comment, updatedBy: updaterId, updatedAt: serverTimestamp()
        });
    },

    async markAsConfirmed(docId) {
        await updateDoc(doc(db, "applications", docId), {
            isConfirmed: true, updatedAt: serverTimestamp()
        });
    },

    async deleteApplication(docId) { await deleteDoc(doc(db, "applications", docId)); },

    subscribeEvents(groupId, callback) {
        const safeGroup = groupId || "NONE";
        const q = query(collection(db, "events"), where("groupId", "==", safeGroup));
        return onSnapshot(q, (snapshot) => {
            const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(events);
        });
    },

    async addEvent(eventData) {
        await addDoc(collection(db, "events"), { ...eventData, createdAt: serverTimestamp() });
    },

    async deleteEvent(id) { await deleteDoc(doc(db, "events", id)); },

    async submitCompletionReport(docId, userId, comment, images = []) {
        const imageUrls = [];
        for (const imgBase64 of images) {
            const url = await this.uploadImage(imgBase64, `completions/${docId}`);
            if (url) imageUrls.push(url);
        }

        const updateData = {
            status: 'completed',
            completedBy: userId,
            updatedAt: serverTimestamp()
        };
        if (comment) updateData.completionComment = comment;
        if (imageUrls.length > 0) updateData.completionImages = imageUrls;
        
        await updateDoc(doc(db, "applications", docId), updateData);
        
        return imageUrls;
    },

    async getUserByName(name) {
        // 🚨 limit(1) を追加して、F12からの全件ダウンロード攻撃を防ぐ
        const q = query(collection(db, "users"), where("name", "==", name), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const data = snap.docs[0].data();
            data.group = data.group || data.groupId || "未設定";
            return { id: snap.docs[0].id, ...data };
        }
        return null;
    },

    // 🚨 危険な updatePassword 機能は完全に削除しました

    async getGroupUsers(groupId) {
        const safeGroup = groupId || "NONE";
        let q = query(collection(db, "users"), where("group", "==", safeGroup));
        let snap = await getDocs(q);
        
        if (snap.empty) {
            q = query(collection(db, "users"), where("groupId", "==", safeGroup));
            snap = await getDocs(q);
        }
        
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
};
