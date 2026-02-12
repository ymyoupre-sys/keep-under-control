import { DB } from "./db.js";
import { Utils } from "./utils.js";

export const Calendar = {
    currentDate: new Date(),
    events: [],
    currentUser: null,
    
    init(user) {
        this.currentUser = user;
        this.startListener();

        document.getElementById('cal-prev-btn').onclick = () => this.changeMonth(-1);
        document.getElementById('cal-next-btn').onclick = () => this.changeMonth(1);
        document.getElementById('save-event-btn').onclick = () => this.saveEvent();
    },

    startListener() {
        DB.subscribeEvents(this.currentUser.group, (allEvents) => {
            this.events = allEvents;
            this.render(); 
        });
    },

    changeMonth(diff) {
        this.currentDate.setMonth(this.currentDate.getMonth() + diff);
        this.render();
    },

    // 帯の位置（段目）を計算して割り当てる関数
    calcEventVisualRows(eventsInMonth) {
        // まず日付順、次に期間が長い順にソート
        const sorted = [...eventsInMonth].sort((a, b) => {
            if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
            const durA = (new Date(a.endDate) - new Date(a.startDate));
            const durB = (new Date(b.endDate) - new Date(b.startDate));
            return durB - durA; 
        });

        // 各イベントに row（0始まり）を割り当てる
        // 簡易的な「貪欲法」で空いている最小の行を探す
        // 日付ごとの使用済み行管理
        const dateRows = {}; // "YYYY/MM/DD": [true, true, false...]

        sorted.forEach(ev => {
            const start = new Date(ev.startDate);
            const end = new Date(ev.endDate);
            
            // このイベントがカバーする日付リストを作成
            const dates = [];
            for(let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                dates.push(`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`);
            }

            // この期間すべてで空いている最小のrowを探す
            let row = 0;
            while (true) {
                let isOk = true;
                for (const dateStr of dates) {
                    if (!dateRows[dateStr]) dateRows[dateStr] = [];
                    if (dateRows[dateStr][row]) {
                        isOk = false;
                        break;
                    }
                }
                if (isOk) break;
                row++;
            }

            // 決定したrowを埋める
            ev.visualRow = row;
            for (const dateStr of dates) {
                if (!dateRows[dateStr]) dateRows[dateStr] = [];
                dateRows[dateStr][row] = true;
            }
        });
        
        return sorted;
    },

    render() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth(); 
        
        document.getElementById('cal-title').textContent = `${year}年 ${month + 1}月`;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay(); 
        const daysInMonth = lastDay.getDate();

        const grid = document.getElementById('calendar-grid');
        grid.innerHTML = '';

        // 空白セル
        for (let i = 0; i < startDayOfWeek; i++) {
            const div = document.createElement('div');
            div.className = 'calendar-day empty';
            grid.appendChild(div);
        }

        // 表示すべきイベントをフィルタリング
        const visibleEvents = this.events.filter(e => {
            if (this.currentUser.role === 'member') {
                // メンバー: リーダーの予定 または 自分の予定
                return e.userRole === 'leader' || e.userId === this.currentUser.id;
            }
            return true; // リーダーは全員分
        });

        // 位置計算
        this.calcEventVisualRows(visibleEvents);

        // カレンダー日付生成
        for (let d = 1; d <= daysInMonth; d++) {
            const currentDayDate = new Date(year, month, d);
            const dateStr = `${year}/${month + 1}/${d}`; // 比較用
            currentDayDate.setHours(0,0,0,0);

            const div = document.createElement('div');
            div.className = 'calendar-day';
            
            // 今日の強調
            const today = new Date();
            today.setHours(0,0,0,0);
            if (currentDayDate.getTime() === today.getTime()) {
                div.classList.add('today');
            }

            div.innerHTML = `<span class="day-num">${d}</span>`;
            
            // この日に表示すべきイベントを探す
            const dayEvents = visibleEvents.filter(e => {
                const s = new Date(e.startDate); s.setHours(0,0,0,0);
                const end = new Date(e.endDate); end.setHours(0,0,0,0);
                return currentDayDate >= s && currentDayDate <= end;
            });

            dayEvents.forEach(e => {
                const bar = document.createElement('div');
                // クラス設定
                let classes = ['event-bar'];
                if (e.userRole === 'leader') classes.push('leader-event');
                
                // 開始日かどうか、終了日かどうか
                // 文字列比較で判定
                if (e.startDate === dateStr.replace(/\//g, '/')) classes.push('is-start'); // DB形式依存吸収のため注意
                // 念のためDateオブジェクトで比較
                const s = new Date(e.startDate); s.setHours(0,0,0,0);
                const end = new Date(e.endDate); end.setHours(0,0,0,0);

                if (currentDayDate.getTime() === s.getTime()) classes.push('is-start');
                if (currentDayDate.getTime() === end.getTime()) classes.push('is-end');

                bar.className = classes.join(' ');
                
                // 位置指定：数字の下(28px) + (行番号 * 8px)
                const topPos = 28 + (e.visualRow * 8);
                bar.style.top = `${topPos}px`;
                
                div.appendChild(bar);
            });

            div.onclick = () => this.openDayModal(currentDayDate, dayEvents);
            grid.appendChild(div);
        }
    },

    openDayModal(dateObj, dayEvents) {
        const dateStr = `${dateObj.getFullYear()}/${dateObj.getMonth()+1}/${dateObj.getDate()}`;
        const listEl = document.getElementById('selected-date-events');
        listEl.innerHTML = `<h6 class="border-bottom pb-2 mb-2">📅 ${dateStr} の予定</h6>`;
        
        if (dayEvents.length === 0) {
            listEl.innerHTML += `<div class="text-muted small">予定はありません</div>`;
        } else {
            dayEvents.forEach(e => {
                const badge = e.userRole === 'leader' ? 'bg-warning text-dark' : 'bg-success';
                let timeInfo = '';
                if (e.startDate && e.endDate && e.startDate !== e.endDate) {
                    timeInfo = `<small class="d-block text-muted" style="font-size:0.7rem">${e.startDate} ~ ${e.endDate}</small>`;
                }

                // 削除ボタンの判定
                // リーダー：誰の予定でも削除可能
                // メンバー：自分の予定のみ削除可能
                let deleteBtn = '';
                const canDelete = (this.currentUser.role === 'leader') || (this.currentUser.role === 'member' && e.userId === this.currentUser.id);

                if (canDelete) {
                    deleteBtn = `
                        <button class="btn btn-sm btn-outline-danger ms-auto" onclick="window.calendar.deleteEvent('${e.id}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    `;
                }

                listEl.innerHTML += `
                    <div class="d-flex align-items-center mb-2 p-2 bg-light rounded">
                        <div class="me-2">
                            <span class="badge ${badge} d-block mb-1">${e.userName}</span>
                        </div>
                        <div class="flex-grow-1">
                            <span class="fw-bold">${e.title}</span>
                            ${timeInfo}
                        </div>
                        ${deleteBtn}
                    </div>`;
            });
        }
    },

    showAddModal() {
        const modalEl = document.getElementById('eventModal');
        const modal = new bootstrap.Modal(modalEl);
        
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;

        document.getElementById('event-start-date').value = todayStr;
        document.getElementById('event-end-date').value = todayStr;
        document.getElementById('event-title-input').value = '';
        
        modal.show();
    },

    async saveEvent() {
        const startDate = document.getElementById('event-start-date').value;
        const endDate = document.getElementById('event-end-date').value;
        const title = document.getElementById('event-title-input').value.trim();
        
        if (!title || !startDate || !endDate) {
            alert('日付と内容を入力してください');
            return;
        }

        if (startDate > endDate) {
            alert('終了日は開始日より後にしてください');
            return;
        }

        try {
            await DB.addEvent({
                groupId: this.currentUser.group,
                userId: this.currentUser.id,
                userName: this.currentUser.name,
                userRole: this.currentUser.role,
                startDate: startDate.replace(/-/g, '/'),
                endDate: endDate.replace(/-/g, '/'),
                title: title
            });
            
            const modalEl = document.getElementById('eventModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
        } catch (e) {
            console.error(e);
            alert('保存失敗');
        }
    },

    async deleteEvent(id) {
        if(!confirm('この予定を削除しますか？')) return;
        try {
            await DB.deleteEvent(id);
            // モーダルリストは再描画されないので、簡易的に閉じるかアラート
            // alert('削除しました');
            // データ更新リスナーがrenderを呼ぶので画面は更新される
        } catch(e) {
            console.error(e);
            alert('削除失敗');
        }
    }
};

window.calendar = Calendar;
