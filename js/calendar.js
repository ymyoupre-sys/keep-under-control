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
            this.events = allEvents.sort((a, b) => {
                // ① まずは開始日の順番に並べる
                const diff = new Date(a.startDate) - new Date(b.startDate);
                if (diff !== 0) return diff;
                
                // ② 開始日が同じ場合は、作成された順番（古い順）に並べる
                const timeA = a.createdAt?.seconds || 0;
                const timeB = b.createdAt?.seconds || 0;
                return timeA - timeB;
            });
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
        
        // 👇 変更：年月を世界共通の「YYYY / MM」フォーマットに変更
        label.textContent = `${y1} / ${String(m1 + 1).padStart(2, '0')}`;
        this.buildGrid('calendar-grid', y1, m1);

        const nextGrid = document.getElementById('calendar-grid-next');
        if (nextGrid) {
            nextGrid.classList.remove('d-none');
            const nextDate = new Date(y1, m1 + 1, 1);
            // 👇 変更：翌月カレンダーのヘッダーも「YYYY / MM」フォーマットに変更
            nextGrid.innerHTML = `<div class="bg-light text-center fw-bold py-1 border-bottom">${nextDate.getFullYear()} / ${String(nextDate.getMonth()+1).padStart(2, '0')}</div>`;
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
        
        // 👇 変更：曜日を英語（Mon, Tue...）に統一
        const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
                cell.className = 'border-end calendar-day d-flex flex-column'; // 👈 p-1 を削除
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

                    const eventContainer = document.createElement('div');
                    eventContainer.className = 'w-100 position-relative';
                    eventContainer.style.marginTop = '2px'; // 👈 mt-1の代わりに極小の余白を設定
                    
                    // 👇 変更：バーの間隔を 20px から 15px に詰める
                    const displayCount = Math.min(dayEvents.length, 3);
                    const moreLabelSpace = dayEvents.length > 3 ? 14 : 0;
                    eventContainer.style.height = `${(displayCount * 15) + moreLabelSpace}px`; 

                    dayEvents.forEach((evt, idx) => {
                        if (idx >= 3) return; 

                        const isStart = new Date(evt.startDate).getDate() === date;
                        const isEnd = new Date(evt.endDate).getDate() === date;

                        const bar = document.createElement('div');
                        bar.className = `event-bar ${evt.userRole === 'leader' ? 'leader-event' : ''} ${isStart ? 'start-day' : ''} ${isEnd ? 'end-day' : ''}`;
                        bar.style.top = `${idx * 15}px`; // 👈 15px間隔で配置
                        bar.style.left = isStart ? '1px' : '-3px';
                        bar.style.right = isEnd ? '1px' : '-3px';
                        bar.textContent = evt.title;
                        
                        bar.onclick = (e) => {
                            e.stopPropagation();
                            this.deleteEvent(evt.id, evt.title);
                        };
                        eventContainer.appendChild(bar);
                    });

                    if (dayEvents.length > 3) {
                        const moreLabel = document.createElement('div');
                        moreLabel.className = 'event-more shadow-sm';
                        // 👇 変更：「+X件」を英語の「+X more」に変更
                        moreLabel.textContent = `+${dayEvents.length - 3} more`;
                        // 👇 変更：ポップアップのタイトルを英語に変更
                        moreLabel.onclick = () => alert(`[ ${m+1}/${date} Events ]\n` + dayEvents.map(e => e.title).join('\n'));
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
        
        // 👇 変更：エラー時のアラート文言を英語に統一
        if (!title || !startDate || !endDate) { alert('Please enter the date and details.'); return; }
        if (startDate > endDate) { alert('End date must be after start date.'); return; }

        try {
            await DB.addEvent({
                groupId: this.currentUser.group,
                userId: this.currentUser.id,
                userName: this.currentUser.name || "名称未設定", // 👈 追加：名前欠落エラー防止
                userRole: this.currentUser.role,
                startDate: (startDate || "").replace(/-/g, '/'), // 👈 追加：クラッシュ防止
                endDate: (endDate || "").replace(/-/g, '/'),     // 👈 追加：クラッシュ防止
                title: title
            });
            
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            document.getElementById('event-title-input').value = '';
        } catch (e) {
            console.error("カレンダー保存エラー:", e); 
            alert('Failed to save.'); 
        } 
    }, 

    async deleteEvent(id, title) {
        // 👇 変更：削除確認のアラート文言を英語に統一
        if(!confirm(`Delete event "${title}"?`)) return;
        try { await DB.deleteEvent(id); } catch (e) { console.error("Delete Error", e); }
    }
};







