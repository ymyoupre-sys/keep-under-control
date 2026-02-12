// js/calendar.js
import { DB } from "./db.js";
import { Utils } from "./utils.js";

export const Calendar = {
    currentDate: new Date(),
    events: [],
    currentUser: null,
    
    init(user) {
        this.currentUser = user;
        this.render();
        this.startListener();

        // ボタン操作
        document.getElementById('cal-prev-btn').onclick = () => this.changeMonth(-1);
        document.getElementById('cal-next-btn').onclick = () => this.changeMonth(1);
        document.getElementById('save-event-btn').onclick = () => this.saveEvent();
    },

    startListener() {
        // グループ全体の予定を取得し、表示時にフィルタリングする
        DB.subscribeEvents(this.currentUser.group, (allEvents) => {
            this.events = allEvents;
            this.render(); // データ更新時に再描画
        });
    },

    changeMonth(diff) {
        this.currentDate.setMonth(this.currentDate.getMonth() + diff);
        this.render();
    },

    render() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth(); // 0-11
        
        // ヘッダー表示
        document.getElementById('cal-title').textContent = `${year}年 ${month + 1}月`;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay(); // 0(Sun) - 6(Sat)
        const daysInMonth = lastDay.getDate();

        const grid = document.getElementById('calendar-grid');
        grid.innerHTML = '';

        // 空白セル（前月分）
        for (let i = 0; i < startDayOfWeek; i++) {
            const div = document.createElement('div');
            div.className = 'calendar-day empty';
            grid.appendChild(div);
        }

        // 日付セル
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}/${month + 1}/${d}`;
            const div = document.createElement('div');
            div.className = 'calendar-day';
            
            // 今日の強調
            const today = new Date();
            if (year === today.getFullYear() && month === today.getMonth() && d === today.getDate()) {
                div.classList.add('today');
            }

            // 日付数字
            div.innerHTML = `<span>${d}</span>`;

            // イベントドット表示
            // 【プライバシー制御】
            // メンバーの場合: 自分の予定(uid === myId) OR リーダーの予定(role === leader)
            // リーダーの場合: 全員見える
            const dayEvents = this.events.filter(e => {
                if (e.date !== dateStr) return false;
                
                if (this.currentUser.role === 'member') {
                    // 自分 または リーダー の予定のみ
                    const isLeader = e.userRole === 'leader';
                    const isMe = e.userId === this.currentUser.id;
                    return isLeader || isMe;
                }
                return true; // リーダーは全部見る
            });

            if (dayEvents.length > 0) {
                const dot = document.createElement('div');
                // リーダーの予定があればオレンジにする、なければ緑
                const hasLeaderEvent = dayEvents.some(e => e.userRole === 'leader');
                dot.className = `event-dot ${hasLeaderEvent ? 'leader-event' : ''}`;
                div.appendChild(dot);
            }

            // クリックイベント
            div.onclick = () => this.openDayModal(dateStr, dayEvents);
            grid.appendChild(div);
        }
    },

    openDayModal(dateStr, dayEvents) {
        // 下部のリスト表示
        const listEl = document.getElementById('selected-date-events');
        listEl.innerHTML = `<h6 class="border-bottom pb-2 mb-2">📅 ${dateStr} の予定</h6>`;
        
        if (dayEvents.length === 0) {
            listEl.innerHTML += `<div class="text-muted small">予定はありません</div>`;
        } else {
            dayEvents.forEach(e => {
                const badge = e.userRole === 'leader' ? 'bg-warning text-dark' : 'bg-success';
                listEl.innerHTML += `
                    <div class="d-flex align-items-center mb-2 p-2 bg-light rounded">
                        <span class="badge ${badge} me-2">${e.userName}</span>
                        <span>${e.title}</span>
                    </div>`;
            });
        }
        
        // 追加ボタン
        listEl.innerHTML += `
            <button class="btn btn-outline-primary btn-sm w-100 mt-3" onclick="window.calendar.showAddModal('${dateStr}')">
                <i class="bi bi-plus-lg"></i> 予定を追加
            </button>
        `;
    },

    showAddModal(dateStr) {
        const modalEl = document.getElementById('eventModal');
        const modal = new bootstrap.Modal(modalEl);
        
        document.getElementById('event-date-hidden').value = dateStr;
        document.getElementById('event-date-display').textContent = dateStr;
        document.getElementById('event-title-input').value = '';
        
        modal.show();
    },

    async saveEvent() {
        const date = document.getElementById('event-date-hidden').value;
        const title = document.getElementById('event-title-input').value.trim();
        
        if (!title) return;

        try {
            await DB.addEvent({
                groupId: this.currentUser.group,
                userId: this.currentUser.id,
                userName: this.currentUser.name,
                userRole: this.currentUser.role,
                date: date,
                title: title
            });
            
            // モーダル閉じる
            const modalEl = document.getElementById('eventModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            
            // リスト更新のために強制クリック（簡易実装）
            // 本当はrenderを呼ぶべきだが、イベントリスナー経由で更新されるのでOK
        } catch (e) {
            console.error(e);
            alert('保存失敗');
        }
    }
};

// グローバル公開
window.calendar = Calendar;
