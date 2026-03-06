import { db, storage } from "./firebase-config.js";
import { 
    collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, setDoc, deleteDoc, getDoc, arrayUnion, arrayRemove, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const getRoomId = (groupId, id1, id2) => {
    if (id1 === "ALL" || id2 === "ALL") return `${groupId}_ALL`;
    const sortedIds = [id1, id2].sort();
    return `${groupId}_${sortedIds[0]}_${sortedIds[1]}`;
};

export const DB = {
    // 🌟 パターンB：画像実体を削除しつつ、テキストの言質を残して退会
    async deleteUserAccount(user) {
        if (!user || !user.id) return;
        const groupId = user.group || "NONE";
        const userId = user.id;
        const authUid = user.authUid;

        // 1. チャットの画像をStorageから削除し、テキストに注記を残す
        try {
            const groupUsers = await this.getGroupUsers(groupId);
            const roomIds = [`${groupId}_ALL`];
            groupUsers.forEach(u => {
                if (u.id !== userId) roomIds.push(this.getChatRoomId(groupId, userId, u.id));
            });

            for (const roomId of roomIds) {
                const q = query(collection(db, "chats", roomId, "messages"), where("senderId", "==", userId));
                const snap = await getDocs(q);
                for (const docSnap of snap.docs) {
                    const data = docSnap.data();
                    if (data.images && data.images.length > 0) {
                        // Storageから実体ファイル（画像）を消去
                        for (const url of data.images) {
                            try {
                                const imgRef = ref(storage, url);
                                await deleteObject(imgRef);
                            } catch (e) { console.warn("Image delete failed (Storage):", e); }
                        }
                        // Firestoreのテキストは残し、「証拠」を維持する
                        await updateDoc(docSnap.ref, {
                            images: [],
                            text: (data.text || "") + "\n※退会したユーザーにより画像が削除されました",
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            }
        } catch (err) { console.error("Chat Cleanup Error:", err); }

        // 2. 申請・完了報告の画像もStorageから削除する
        try {
            const appQ = query(collection(db, "applications"), where("groupId", "==", groupId));
            const appSnap = await getDocs(appQ);
            for (const docSnap of appSnap.docs) {
                const data = docSnap.data();
                let needsUpdate = false;
                let updateData = {};

                // 自分が送った申請の画像掃除
                if (data.userId === userId && data.images && data.images.length > 0) {
                    for (const url of data.images) {
                        try { await deleteObject(ref(storage, url)); } catch (e) {}
                    }
                    updateData.images = [];
                    updateData.content = (data.content || "") + "\n※退会により画像削除";
                    needsUpdate = true;
                }
                // 自分が送った完了報告の画像掃除
                if (data.completedBy === userId && data.completionImages && data.completionImages.length > 0) {
                    for (const url of data.completionImages) {
                        try { await deleteObject(ref(storage, url)); } catch (e) {}
                    }
                    updateData.completionImages = [];
                    updateData.completionComment = (data.completionComment || "") + "\n※退会により画像削除";
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    await updateDoc(docSnap.ref, updateData);
                }
            }
        } catch (err) { console.error("App Cleanup Error:", err); }

        // 3. 最後に自分自身の名簿と証明書を削除
        if (authUid) {
            await deleteDoc(doc(db, "auth_bridge", authUid));
        }
        await deleteDoc(doc(db, "users", userId));
    },

    // 利用規約の同意フラグを保存する
    async agreeToTerms(userId) {
        await updateDoc(doc(db, "users", userId), { 
            agreedToTerms: true,
            agreedTermsVersion: 4, 
            updatedAt: serverTimestamp()
        });
    },

    async createAuthBridge(authUid, userId, group, role) {
        if (!authUid || !userId) return;
        try {
            await updateDoc(doc(db, "users", userId), {
                authUid: authUid,
                updatedAt: serverTimestamp()
            });

            await setDoc(doc(db, "auth_bridge", authUid), {
                userId: userId,
                group: group || "未設定",
                role: role || "member",
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.error("Bridge Error:", e);
        }
    },

    async saveUserToken(user, token) {
        if (!user || !user.id) return;
        const userRef = doc(db, "users", user.id);
        const updateData = {
            name: user.name || "名称未設定",
            icon: user.icon || "👤",
            updatedAt: serverTimestamp()
        };
        if (token) updateData.fcmToken = token;
        try {
            await setDoc(userRef, updateData, { merge: true });
        } catch (e) {
            console.error("トークン保存エラー:", e);
        }
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

    // 🌟 新規：チャットルームのメタ情報（既読情報など）をリアルタイム購読
    subscribeRoomMeta(chatRoomId, callback) {
        return onSnapshot(doc(db, "chats", chatRoomId), (snap) => {
            callback(snap.exists() ? snap.data() : {});
        });
    },

    // 🌟 新規：チャットルームのメタ情報を1回だけ取得（チャット一覧用）
    async getRoomMeta(chatRoomId) {
        try {
            const snap = await getDoc(doc(db, "chats", chatRoomId));
            return snap.exists() ? snap.data() : null;
        } catch (e) {
            return null;
        }
    },

    // 🌟 新規：既読情報を更新
    async updateLastRead(chatRoomId, userId) {
        try {
            await setDoc(doc(db, "chats", chatRoomId), { 
                [`lastRead_${userId}`]: serverTimestamp() 
            }, { merge: true });
        } catch (e) {
            console.warn("lastRead update failed:", e);
        }
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
            const url = await this.uploadImage(imgBase64, `chats/${safeGroup}/${chatRoomId}`);
            if (url) imageUrls.push(url);
        }

        await addDoc(collection(db, "chats", chatRoomId, "messages"), {
            text: text, senderId: sender.id, senderName: sender.name || "名称未設定", senderIcon: sender.icon || "👤",
            images: imageUrls, reactions: [], isEdited: false, isDeleted: false, createdAt: serverTimestamp()
        });
        const lastMsgText = text || (imageUrls.length > 0 ? '画像が送信されました' : '');
        // 🌟 変更：最終送信者の情報もルームドキュメントに保存（チャット一覧での表示用）
        await setDoc(doc(db, "chats", chatRoomId), { 
            lastMessage: lastMsgText, 
            lastSenderId: sender.id,
            lastSenderName: sender.name || "名称未設定",
            lastSenderIcon: sender.icon || "👤",
            updatedAt: serverTimestamp() 
        }, { merge: true });
    },

    async updateMessage(groupId, id1, id2, messageId, newText) {
        const safeGroup = groupId || "NONE";
        const chatRoomId = getRoomId(safeGroup, id1, id2);
        await updateDoc(doc(db, "chats", chatRoomId, "messages", messageId), { text: newText, isEdited: true, updatedAt: serverTimestamp() });
    },

    // 🌟 新規：メッセージの論理削除
    async deleteMessage(groupId, id1, id2, messageId) {
        const safeGroup = groupId || "NONE";
        const chatRoomId = getRoomId(safeGroup, id1, id2);
        await updateDoc(doc(db, "chats", chatRoomId, "messages", messageId), { 
            text: "", 
            images: [], 
            isDeleted: true, 
            isEdited: false,
            updatedAt: serverTimestamp() 
        });
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
            createdDateStr: formattedDate 
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

    // 🌟 変更：複数メンバーの完了報告に対応
    async submitCompletionReport(docId, groupId, userId, comment, images = []) {
        const imageUrls = [];
        for (const imgBase64 of images) {
            const url = await this.uploadImage(imgBase64, `completions/${groupId}/${docId}`);
            if (url) imageUrls.push(url);
        }

        // 現在のドキュメントを取得して completedByList を更新
        const appDoc = await getDoc(doc(db, "applications", docId));
        const appData = appDoc.exists() ? appDoc.data() : {};
        
        const currentList = appData.completedByList || [];
        if (!currentList.includes(userId)) {
            currentList.push(userId);
        }

        // 全対象メンバーが完了したかチェック
        const targetMemberIds = appData.targetMemberIds || [];
        const allCompleted = targetMemberIds.length > 0 
            ? targetMemberIds.every(id => currentList.includes(id))
            : true;

        const updateData = {
            completedBy: userId,
            completedByList: currentList,
            updatedAt: serverTimestamp()
        };

        // メンバー個別の報告データをマップに保存
        const reportData = {};
        if (comment) reportData.comment = comment;
        if (imageUrls.length > 0) reportData.images = imageUrls;
        updateData[`completionReports.${userId}`] = reportData;

        // 後方互換性のために従来のフィールドも更新
        if (comment) updateData.completionComment = comment;
        if (imageUrls.length > 0) updateData.completionImages = imageUrls;

        // 全員完了の場合のみステータスを変更
        if (allCompleted) {
            updateData.status = 'completed';
        }
        
        await updateDoc(doc(db, "applications", docId), updateData);
        
        return imageUrls;
    },

    async getUserByName(name) {
        const safeHexEncode = (str) => {
            return Array.from(new TextEncoder().encode(str))
                .map(b => b.toString(16).padStart(2, '0')).join('');
        };
        const loginId = safeHexEncode(name);

        const q = query(collection(db, "users"), where("loginId", "==", loginId), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const data = snap.docs[0].data();
            data.group = data.group || data.groupId || "未設定";
            return { id: snap.docs[0].id, ...data };
        }
        return null;
    },

    async getUserByAuthUid(authUid) {
        const q = query(collection(db, "users"), where("authUid", "==", authUid), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const data = snap.docs[0].data();
            data.group = data.group || data.groupId || "未設定";
            return { id: snap.docs[0].id, ...data };
        }
        return null;
    },

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
