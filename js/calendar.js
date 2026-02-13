import { DB } from "./db.js";

export const Calendar = {
    currentDate: new Date(),
    events: [],
    currentUser: null,
    holidays: {}, // 祝日データ格納用
    
    async init(user) {
        this.currentUser = user;
        
        // 祝日データの取得 (内閣府データに基づくAPI)
        try {
            const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
            this.holidays = await res.json();
        } catch(e) { console.warn("祝日取得エラー", e); }

        this.startListener();

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
        if (!label) return;

        const y1 = this.currentDate.getFullYear();
        const m1 = this.currentDate.getMonth();
        
        label.textContent = `${y1}年 ${m1 + 1}月`;
        this.buildGrid('calendar-grid', y1, m1);

        // リーダーの場合は来月も表示
        const nextGrid = document.getElementById('calendar-grid-next');
        if (this.currentUser.role === 'leader' && nextGrid) {
            nextGrid.classList.remove('d-none');
            // 次の月を計算
            const nextDate = new Date(y1, m1 + 1, 1);
            // 枠の上に「〇月」というラベルを追加する
            nextGrid.innerHTML = `<div class="bg-light text-center fw-bold py-1 border-bottom">${nextDate.getMonth()+1}月</div>`;
            this.buildGrid('calendar-grid-next', nextDate.getFullYear(), nextDate.getMonth(), true);
        }
    },

    buildGrid(targetId, y, m, append = false) {
        const grid = document.getElementById(targetId);
        if(!grid) return;
        if(!append) grid.innerHTML = '';

        // 月曜始まりの計算
        const firstDayObj = new Date(y, m, 1);
        // getDay()は 日0, 月1...。これを 月0, 火1...日6 に変換
        const firstDay = (firstDayObj.getDay() + 6) % 7; 
        const lastDate = new Date(y, m + 1, 0).getDate();
        
        // ヘッダー
        const weekDays = ['月', '火', '水', '木', '金', '土', '日'];
        const headerRow = document.createElement('div');
        headerRow.className = 'd-flex border-bottom bg-light fw-bold text-center';
        weekDays.forEach((day, idx) => {
            const div = document.createElement('div');
            div.style.flex = '1';
            div.textContent = day;
            if(idx === 5) div.className = 'cal-sat'; // 土曜
            if(idx === 6) div.className = 'cal-sun'; // 日曜
            headerRow.appendChild(div);
        });
        grid.appendChild(headerRow);

        let date = 1;
        for (let i = 0; i < 6; i++) {
            const row = document.createElement('div');
            row.className = 'd-flex border-bottom position-relative';
            row.style.minHeight = '90px';
            
            for (let j = 0; j < 7; j++) {
                const cell = document.createElement('div');
                cell.className = 'border-end p-1 calendar-day d-flex flex-column';
                cell.style.flex = '1';
                cell.style.width = '14.28%';

                if (i === 0 && j < firstDay) {
                    cell.className += ' bg-light'; 
                } else if (date > lastDate) {
                    cell.className += ' bg-light'; 
                } else {
                    const currentDateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
                    const isHoliday = !!this.holidays[currentDateStr];
                    
                    let dayClass = '';
                    if (isHoliday) dayClass = 'cal-holiday';
                    else if (j === 5) dayClass = 'cal-sat';
                    else if (j === 6) dayClass = 'cal-sun';

                    const today = new Date();
                    if(date === today.getDate() && m === today.getMonth() && y === today.getFullYear()) {
                        cell.classList.add('today');
                    }

                    cell.innerHTML = `<span class="day-num ${dayClass}">${date}</span>`;

                    // この日のイベントを取得
                    const dayEvents = this.events.filter(e => {
                        const start = new Date(e.startDate);
                        const end = new Date(e.endDate);
                        const cur = new Date(y, m, date);
                        return cur >= start && cur <= end;
                    });

                    // イベント表示 (最大3件まで)
                    const eventContainer = document.createElement('div');
                    eventContainer.className = 'mt-1 w-100 position-relative';
                    eventContainer.style.flex = '1';

                    dayEvents.forEach((evt, idx) => {
                        if (idx >= 3) return; // 3件目以降は隠す

                        const isStart = new Date(evt.startDate).getDate() === date;
                        const isEnd = new Date(evt.endDate).getDate() === date;

                        const bar = document.createElement('div');
                        bar.className = `event-bar ${evt.userRole === 'leader' ? 'leader-event' : ''} ${isStart ? 'start-day' : ''} ${isEnd ? 'end-day' : ''}`;
                        bar.style.top = `${idx * 20}px`; // 縦の位置をずらす
                        bar.textContent = evt.title;
                        
                        bar.onclick = (e) => {
                            e.stopPropagation();
                            this.deleteEvent(evt.id);
                        };
                        eventContainer.appendChild(bar);
                    });

                    // 4件以上ある場合は「+X件」を表示
                    if (dayEvents.length > 3) {
                        const moreLabel = document.createElement('div');
                        moreLabel.className = 'event-more shadow-sm';
                        moreLabel.textContent = `+${dayEvents.length - 3}件`;
                        moreLabel.onclick = () => alert(`【${m+1}/${date}の予定】\n` + dayEvents.map(e => e.title).join('\n'));
                        cell.appendChild(moreLabel);
                    }

                    cell.appendChild(eventContainer);
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
        
        if (!title || !startDate || !endDate) { alert('日付と内容を入力してください'); return; }
        if (startDate > endDate) { alert('終了日は開始日より後にしてください'); return; }

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
            
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            document.getElementById('event-title-input').value = '';
        } catch (e) { alert('保存失敗'); }
    },

    async deleteEvent(id) {
        if(!confirm('この予定を削除しますか？')) return;
        try { await DB.deleteEvent(id); } catch (e) { console.error("Delete Error", e); }
    }
};
