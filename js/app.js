// Phase 1: 設定読込とUI制御のみ

let CONFIG_USERS = [];
let CONFIG_SETTINGS = {};
let CURRENT_USER = null;

const App = {
    async init() {
        console.log("App Initializing...");
        
        // 1. 設定ファイルの読み込み
        try {
            const [usersRes, settingsRes] = await Promise.all([
                fetch('config/users.json'),
                fetch('config/settings.json')
            ]);
            CONFIG_USERS = await usersRes.json();
            CONFIG_SETTINGS = await settingsRes.json();
            
            this.setupLogin();
            this.setupTabs();
            
        } catch (e) {
            console.error("設定読み込みエラー", e);
            alert("設定ファイルの読み込みに失敗しました");
        }
    },

    setupLogin() {
        const btn = document.getElementById('login-btn');
        const input = document.getElementById('login-name');

        // 前回のログイン情報があれば自動復帰
        const savedUser = localStorage.getItem('app_user_v2');
        if (savedUser) {
            this.loginSuccess(JSON.parse(savedUser));
            return;
        }

        btn.addEventListener('click', () => {
            const name = input.value.trim();
            const user = CONFIG_USERS.find(u => u.name === name);
            
            if (user) {
                localStorage.setItem('app_user_v2', JSON.stringify(user));
                this.loginSuccess(user);
            } else {
                document.getElementById('login-error').classList.remove('d-none');
            }
        });
    },

    loginSuccess(user) {
        CURRENT_USER = user;
        
        // 画面切り替え
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app-screen').classList.remove('d-none');
        
        // ヘッダー情報の更新
        document.getElementById('user-display').textContent = `${user.group}｜${user.name}`;
        
        // ロールによる表示切り替え
        this.updateUIByRole(user);
    },

    updateUIByRole(user) {
        // ラベルの書き換え
        const formTitle = document.getElementById('form-title-label');
        const navChat = document.getElementById('nav-label-chat');
        const navForm = document.getElementById('nav-label-form');
        const typeSelect = document.getElementById('form-type');

        typeSelect.innerHTML = ''; // リセット

        if (user.role === 'leader') {
            // リーダー向けUI
            navChat.textContent = "連絡";
            navForm.textContent = "指示";
            formTitle.textContent = "メンバーへ指示";
            
            // 指示メニューの生成
            CONFIG_SETTINGS.instructionTypes.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t; opt.text = t;
                typeSelect.appendChild(opt);
            });

        } else {
            // メンバー向けUI
            navChat.textContent = "報告";
            navForm.textContent = "申請";
            formTitle.textContent = "リーダーへ申請";
            
            // 申請メニューの生成
            CONFIG_SETTINGS.applicationTypes.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t; opt.text = t;
                typeSelect.appendChild(opt);
            });
        }
    },

    setupTabs() {
        const navLinks = document.querySelectorAll('.nav-link[data-target]');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                // タブのActive切り替え
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');

                // コンテンツの表示切り替え
                const targetId = link.getAttribute('data-target');
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
                document.querySelector(targetId).classList.add('show', 'active');
                
                // ヘッダータイトルの更新
                const titleMap = {
                    '#tab-inbox': '受信箱',
                    '#tab-chat': document.getElementById('nav-label-chat').textContent,
                    '#tab-form': document.getElementById('nav-label-form').textContent,
                    '#tab-calendar': '予定'
                };
                document.getElementById('header-title').textContent = titleMap[targetId];
            });
        });
        
        // ログアウト処理
        document.getElementById('logout-btn').addEventListener('click', () => {
            if(confirm('ログアウトしますか？')) {
                localStorage.removeItem('app_user_v2');
                location.reload();
            }
        });
    }
};

window.onload = () => App.init();
