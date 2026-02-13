import { DB } from "./db.js";

export const Calendar = {
    currentDate: new Date(),
    events: [],
    currentUser: null,
    holidays: {}, 
    
    async init(user) {
        this.currentUser = user;
        
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
            // 開始日順に並び替えておく（表示順を揃えるため）
            this.events = allEvents.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
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

        const nextGrid = document.getElementById('calendar-grid-next');
        if (this.currentUser.role === 'leader' && nextGrid) {
            nextGrid.classList.remove('d-none');
            const nextDate = new Date(y1, m1 + 1, 1);
            nextGrid.innerHTML = `<div class="bg-light text-center fw-bold py-1 border-bottom">${nextDate.getMonth()+1}月</div>`;
            this.buildGrid('calendar-grid-next', nextDate.getFullYear(), nextDate.getMonth(), true);
        }
    },

    buildGrid(targetId, y, m, append = false) {
        const grid = document.getElementById(targetId);
        if(!grid) return;
        if(!append) grid.innerHTML = '';

        const firstDayObj = new Date(y, m, 1);
        const firstDay = (firstDayObj.getDay() + 6) % 7; 
        const lastDate = new Date(y, m + 1, 0).getDate();
        
        const weekDays = ['月', '火', '水', '木', '金', '土', '日'];
        const headerRow = document.createElement('div');
        headerRow.className = 'd-flex border-bottom bg-light fw-bold text-center';
        weekDays.forEach((day, idx) => {
            const div = document.createElement('div');
            div.style.flex = '1';
            div.textContent = day;
            if(idx === 5) div.className = 'cal-sat'; 
            if(idx === 6) div.className = 'cal-sun'; 
            headerRow.appendChild(div);
        });
        grid.appendChild(headerRow);

        let date = 1;
        for (let i = 0; i < 6; i++) {
            const row = document.createElement('div');
            row.className = 'd-flex border-bottom position-relative';
            
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

                    const dayEvents = this.events.filter(e => {
                        const start = new Date(e.startDate);
                        const end = new Date(e.endDate);
                        const cur = new Date(y, m, date);
                        return cur >= start && cur <= end;
                    });

                    // ★修正：3件分の高さを必ず確保する（絶対配置での重なりを防ぐ）
                    const eventContainer = document.createElement('div');
                    eventContainer.className = 'mt-1 w-100 position-relative';
                    eventContainer.style.height = '60px'; 

                    dayEvents.forEach((evt, idx) => {
                        if (idx >= 3) return; 

                        const isStart = new Date(evt.startDate).getDate() === date;
                        const isEnd = new Date(evt.endDate).getDate() === date;

                        const bar = document.createElement('div');
                        // ★修正：開始日/終了日以外は左右の枠線を貫通するように調整
                        bar.className = `event-bar ${evt.userRole === 'leader' ? 'leader-event' : ''} ${isStart ? 'start-day' : ''} ${isEnd ? 'end-day' : ''}`;
                        bar.style.top = `${idx * 20}px`;
                        bar.style.left = isStart ? '2px' : '-5px';
                        bar.style.right = isEnd ? '2px' : '-5px';
                        bar.textContent = evt.title;
                        
                        bar.onclick = (e) => {
                            e.stopPropagation();
                            this.deleteEvent(evt.id);
                        };
                        eventContainer.appendChild(bar);
                    });

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
