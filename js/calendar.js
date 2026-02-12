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
        // HTML側にある保存ボタンにイベントを紐づけ
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

        for (let i = 0; i < startDayOfWeek; i++) {
            const div = document.createElement('div');
            div.className = 'calendar-day empty';
            grid.appendChild(div);
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const currentDayDate = new Date(year, month, d);
            currentDayDate.setHours(0,0,0,0);

            const div = document.createElement('div');
            div.className = 'calendar-day';
            
            const today = new Date();
            today.setHours(0,0,0,0);
            if (currentDayDate.getTime() === today.getTime()) {
                div.classList.add('today');
            }

            div.innerHTML = `<span class="day-num">${d}</span>`;
            
            const barContainer = document.createElement('div');
            barContainer.className = 'event-bar-container';

            const dayEvents = this.events.filter(e => {
                let isVisible = true;
                if (this.currentUser.role === 'member') {
                    const isLeader = e.userRole === 'leader';
                    const isMe = e.userId === this.currentUser.id;
                    isVisible = isLeader || isMe;
                }
                if (!isVisible) return false;

                if (e.startDate && e.endDate) {
                    const s = new Date(e.startDate); s.setHours(0,0,0,0);
                    const end = new Date(e.endDate); end.setHours(0,0,0,0);
                    return currentDayDate >= s && currentDayDate <= end;
                }
                return false;
            });

            dayEvents.forEach(e => {
                const bar = document.createElement('div');
                bar.className = `event-bar ${e.userRole === 'leader' ? 'leader-event' : ''}`;
                barContainer.appendChild(bar);
            });

            div.appendChild(barContainer);
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

                listEl.innerHTML += `
                    <div class="d-flex align-items-center mb-2 p-2 bg-light rounded">
                        <div class="me-2">
                            <span class="badge ${badge} d-block mb-1">${e.userName}</span>
                        </div>
                        <div>
                            <span class="fw-bold">${e.title}</span>
                            ${timeInfo}
                        </div>
                    </div>`;
            });
        }
        
        // ★修正：ここにボタンを追加するコードを削除（重複防止）
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
        // ★修正：HTMLのIDと一致させる
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
    }
};

window.calendar = Calendar;
