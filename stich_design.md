<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
          darkMode: "class",
          theme: {
            extend: {
              colors: {
                "primary": "#137fec",
                "background-light": "#f6f7f8",
                "background-dark": "#101922",
                "sidebar-grey": "#e5e7eb",
                "sidebar-hover": "#d1d5db",
                "win-red": "#ff5f56",
                "win-yellow": "#ffbd2e",
                "win-green": "#27c93f"
              },
              fontFamily: {
                "display": ["Inter", "sans-serif"]
              },
              borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
            },
          },
        }
    </script>
<style type="text/tailwindcss">
        body { font-family: 'Inter', sans-serif; }
        .sidebar-height { height: calc(100vh - 48px - 32px); }
        body {
            min-height: max(884px, 100dvh);
        }
    </style>
<title>전국휴게소 오수처리장 통합관리시스템</title>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background-light dark:bg-background-dark font-display h-screen flex flex-col overflow-hidden text-slate-800">
<header class="h-12 bg-slate-100 border-b border-slate-300 flex items-center justify-between px-4 z-50 shrink-0">
<a class="flex items-center gap-3 hover:opacity-80 transition-opacity" href="#">
<div class="w-7 h-7 bg-primary rounded flex items-center justify-center">
<span class="material-icons text-white text-sm">water_drop</span>
</div>
<h1 class="font-bold text-sm tracking-tight text-slate-700">전국휴게소 오수처리장 통합관리시스템</h1>
</a>
<div class="flex items-center gap-2">
<div class="flex gap-2 mr-4">
<div class="w-3 h-3 rounded-full bg-slate-300"></div>
<div class="w-3 h-3 rounded-full bg-slate-300"></div>
<div class="w-3 h-3 rounded-full bg-slate-300"></div>
</div>
<div class="flex items-center border-l border-slate-300 pl-4 h-6 gap-2">
<span class="material-icons text-slate-400 text-lg cursor-default select-none">minimize</span>
<span class="material-icons text-slate-400 text-lg cursor-default select-none">check_box_outline_blank</span>
<span class="material-icons text-slate-400 text-lg hover:text-red-500 cursor-pointer">close</span>
</div>
</div>
</header>
<div class="flex flex-1 overflow-hidden">
<aside class="w-[250px] bg-sidebar-grey border-r border-slate-300 flex flex-col sidebar-height shrink-0">
<div class="p-5">
<div class="bg-white rounded-lg p-4 shadow-sm border border-slate-300">
<div class="flex items-center gap-3 mb-4">
<div class="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold text-lg">
                            K
                        </div>
<div class="flex flex-col">
<span class="text-xs text-slate-500 font-medium">관리자</span>
<span class="text-sm font-bold text-slate-800 tracking-tight">김관리 차장</span>
</div>
</div>
<div class="grid grid-cols-2 gap-2">
<button class="flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-100 hover:bg-primary/10 hover:text-primary rounded text-[11px] font-semibold text-slate-600 transition-colors border border-slate-200">
<span class="material-icons text-[14px]">edit</span>
                            정보수정
                        </button>
<button class="flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-100 hover:bg-red-50 hover:text-red-600 rounded text-[11px] font-semibold text-slate-600 transition-colors border border-slate-200">
<span class="material-icons text-[14px]">logout</span>
                            로그아웃
                        </button>
</div>
</div>
</div>
<nav class="flex-1 px-3 space-y-1 overflow-y-auto">
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">water_damage</span>
<span>유량관리</span>
</a>
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">science</span>
<span>약품관리</span>
</a>
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">opacity</span>
<span>수질관리</span>
</a>
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">construction</span>
<span>시설관리</span>
</a>
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">edit_note</span>
<span>일지작성</span>
</a>
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">forum</span>
<span>소통게시판</span>
</a>
</nav>
<div class="p-3 mt-auto border-t border-slate-300">
<a class="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-sidebar-hover rounded-lg transition-colors group" href="#">
<span class="material-icons text-slate-400 group-hover:text-slate-600">settings</span>
<span>설정</span>
</a>
</div>
</aside>
<main class="flex-1 bg-background-light dark:bg-background-dark p-8 flex flex-col items-center justify-center">
<div class="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-sm p-16 flex flex-col items-center justify-center text-center">
<div class="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
<span class="material-icons text-slate-300 text-5xl">pending_actions</span>
</div>
<h2 class="text-2xl font-bold text-slate-800 mb-2">대시보드 준비 중입니다</h2>
<p class="text-slate-500 mb-8 max-w-md">
                    현재 시스템 초기화 및 데이터 동기화 작업이 진행 중입니다. 잠시 후 상세 관리 현황을 확인하실 수 있습니다.
                </p>
<div class="flex gap-4">
<div class="h-1.5 w-12 bg-primary/20 rounded-full overflow-hidden">
<div class="h-full bg-primary w-1/2"></div>
</div>
<div class="h-1.5 w-12 bg-slate-100 rounded-full"></div>
<div class="h-1.5 w-12 bg-slate-100 rounded-full"></div>
</div>
</div>
</main>
</div>
<footer class="h-8 bg-slate-800 text-slate-300 flex items-center justify-between px-4 text-[11px] shrink-0">
<div class="flex items-center gap-6">
<div class="flex items-center gap-2">
<span class="material-icons text-[14px] text-primary">navigation</span>
<span>현재 메뉴: <span class="text-white font-medium">대시보드</span></span>
</div>
<div class="flex items-center gap-2 border-l border-slate-600 pl-6">
<span class="material-icons text-[14px] text-green-400">info</span>
<span>도움말: 각 항목의 상세 데이터는 왼쪽 메뉴를 통해 접근하세요.</span>
</div>
</div>
<div class="flex items-center gap-4">
<div class="flex items-center gap-2">
<span class="material-icons text-[14px] text-slate-400">login</span>
<span>로그인 시간: <span class="text-white">2023-10-27 09:00:12</span></span>
</div>
<div class="flex items-center gap-2 bg-slate-700 px-2 py-0.5 rounded text-white">
<div class="w-1.5 h-1.5 rounded-full bg-green-400"></div>
<span>서버 상태: 양호</span>
</div>
</div>
</footer>

</body></html>

#로그인디자인

<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        "corporate-blue": "#0a58ca",
                        "bg-neutral": "#f8f9fa",
                    },
                    fontFamily: {
                        "sans": ["Inter", "Malgun Gothic", "sans-serif"]
                    }
                },
            },
        }
    </script>
<style type="text/tailwindcss">
        body {
            background-color: theme('colors.bg-neutral');
        }
        .login-card {
            width: 350px;
            min-height: 300px;
        }
    </style>
<title>더죤환경기술(주) 오수처리 통합관리시스템 - 로그인</title>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="flex items-center justify-center min-h-screen p-4">
<div class="login-card bg-white rounded-lg shadow-lg border border-slate-100 flex flex-col overflow-hidden">
<div class="pt-8 pb-6 px-6 text-center">
<h1 class="text-[17px] font-bold text-slate-800 leading-tight">
                더죤환경기술(주)<br/>
<span class="text-slate-600 font-semibold text-[15px]">오수처리 통합관리시스템</span>
</h1>
</div>
<form action="#" class="px-6 pb-8 space-y-3" onsubmit="return false;">
<div class="relative">
<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">person</span>
<input class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-corporate-blue/20 focus:border-corporate-blue outline-none transition-all placeholder:text-slate-400" placeholder="이름" type="text"/>
</div>
<div class="relative">
<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">lock</span>
<input class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-corporate-blue/20 focus:border-corporate-blue outline-none transition-all placeholder:text-slate-400" placeholder="비밀번호" type="password"/>
</div>
<button class="w-full bg-corporate-blue hover:bg-blue-700 text-white font-bold py-3 rounded mt-2 transition-colors flex items-center justify-center text-sm shadow-sm active:bg-blue-800" type="submit">
                로그인
            </button>
</form>
</div>

</body></html>