import { DB } from "./db.js";
import { Utils } from "./utils.js";

export const Calendar = {
    currentDate: new Date(),
    events: [],
    currentUser: null,
    
    init(user) {
        this.currentUser = user;
        this.startListener();

        // ボタンが存在する場合のみイベントを設定（エラー回避）
        const prevBtn = document.getElementById('cal-prev-btn');
        const nextBtn = document.getElementById('cal-next-btn');
        const saveBtn = document.getElementById('save-event-btn');

        if(prevBtn) prevBtn.onclick = () => this.changeMonth(-1);
        if(nextBtn) nextBtn.onclick = () => this.changeMonth(1);
        if(saveBtn) saveBtn.onclick = () => this.saveEvent();
    },

    startListener() {
        if(!this.currentUser || !this.currentUser.group) return;
        
        DB.subscribeEvents(this.currentUser.group, (allEvents) => {
            this.events = allEvents;
            this.render(); 
        });
    },

    changeMonth(diff) {
        this.currentDate.setMonth(this.currentDate.getMonth() + diff);
        this.render();
    },

    render() {
        const label = document.getElementById('cal-month-label');
        const grid = document.getElementById('calendar-grid');

        // ★安全装置：HTMLの更新がまだ反映されていない場合、ここで処理を中断してエラーを防ぐ
        if (!label || !grid) {
            console.warn("カレンダー要素が見つかりません。HTMLの更新を待っています...");
            return;
        }

        const y = this.currentDate.getFullYear();
        const m = this.currentDate.getMonth();
        
        label.textContent = `${y}年 ${m + 1}月`;
        grid.innerHTML = ''; // クリア

        // カレンダー生成ロジック
        const firstDay = new Date(y, m, 1).getDay();
        const lastDate = new Date(y, m + 1, 0).getDate();
        
        // 曜日ヘッダー
        const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
        const headerRow = document.createElement('div');
        headerRow.className = 'd-flex border-bottom bg-light fw-bold text-center';
        weekDays.forEach(day => {
            const div = document.createElement('div');
            div.style.flex = '1';
            div.textContent = day;
            headerRow.appendChild(div);
        });
        grid.appendChild(headerRow);

        // 日付セル生成
        let date = 1;
        // 6週間分ループ（最大）
        for (let i = 0; i < 6; i++) {
            const row = document.createElement('div');
            row.className = 'd-flex border-bottom';
            row.style.minHeight = '80px';
            
            let hasDateInRow = false;

            for (let j = 0; j < 7; j++) {
                const cell = document.createElement('div');
                cell.className = 'border-end p-1 position-relative';
                cell.style.flex = '1';
                cell.style.fontSize = '12px';

                if (i === 0 && j < firstDay) {
                    cell.className += ' bg-light'; // 先月の空白
                } else if (date > lastDate) {
                    cell.className += ' bg-light'; // 来月の空白
                } else {
                    hasDateInRow = true;
                    cell.textContent = date;
                    
                    // 今日の日付強調
                    const today = new Date();
                    if(date === today.getDate() && m === today.getMonth() && y === today.getFullYear()) {
                        cell.className += ' bg-info bg-opacity-10 fw-bold';
                    }

                    // イベント表示
                    const dayEvents = this.events.filter(e => {
                        const start = new Date(e.startDate);
                        const end = new Date(e.endDate);
                        const current = new Date(y, m, date);
                        return current >= start && current <= end;
                    });

                    dayEvents.forEach(evt => {
                        const badge = document.createElement('div');
                        badge.className = 'badge bg-primary text-wrap text-start w-100 mt-1';
                        badge.style.fontSize = '10px';
                        badge.textContent = evt.title;
                        
                        // 削除機能
                        badge.onclick = (e) => {
                            e.stopPropagation();
                            this.deleteEvent(evt.id);
                        };
                        cell.appendChild(badge);
                    });

                    date++;
                }
                row.appendChild(cell);
            }
            grid.appendChild(row);
            if (date > lastDate) break;
        }
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
            
            // モーダルを閉じる
            const modalEl = document.getElementById('eventModal');
            // @ts-ignore
            const modal = bootstrap.Modal.getInstance(modalEl);
            if(modal) modal.hide();
            
            // 入力クリア
            document.getElementById('event-title-input').value = '';
            
        } catch (e) {
            console.error(e);
            alert('保存失敗');
        }
    },

    async deleteEvent(id) {
        if(!confirm('この予定を削除しますか？')) return;
        try {
            await DB.deleteEvent(id);
        } catch (e) {
            console.error("Delete Error", e);
        }
    }
};
