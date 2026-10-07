# practice_toeic_writing_part1

> Ứng dụng Desktop Windows luyện viết câu TOEIC Writing Part 1 (Write a Sentence Based on a Picture) với trợ lý AI chấm điểm theo chuẩn ETS.

[![Build & Test](https://github.com/torang295-pixel/practice-writing-toeic-part1/actions/workflows/ci.yml/badge.svg)](https://github.com/torang295-pixel/practice-writing-toeic-part1/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![.NET](https://img.shields.io/badge/.NET-10.0-purple.svg)](https://dotnet.microsoft.com/)
[![WebView2](https://img.shields.io/badge/WebView2-WinForms-blue.svg)](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

---

## 📌 Giới thiệu

`practice_toeic_writing_part1` là ứng dụng desktop chạy trực tiếp trên Windows, kết hợp giao diện Web hiện đại (HTML5/CSS3/JavaScript) thông qua **Microsoft Edge WebView2** và runtime native **.NET 10 (C# WinForms)**. 

Ứng dụng hỗ trợ kết nối với các mô hình AI ngôn ngữ lớn (LLM) tương thích chuẩn OpenAI (OpenAI, Gemini via 9router, DeepSeek, v.v.) để tự động phân tích hình ảnh, sinh 2 từ gợi ý và chấm điểm câu viết của thí sinh theo thang điểm chuẩn ETS (0 - 3 điểm).

---

## ✨ Tính năng nổi bật

- **Tải ảnh linh hoạt:** Hỗ trợ kéo thả hoặc chọn nhiều ảnh định dạng JPEG, PNG, WebP (tối đa 15 MB/ảnh). Tự động tối ưu hóa kích thước trước khi xử lý.
- **Tự động sinh từ gợi ý:** Gọi AI phân tích bối cảnh bức tranh và tạo 2 từ gợi ý chuẩn format thi TOEIC Part 1.
- **Chấm điểm thông minh chuẩn ETS:**
  - Chấm thang điểm 0 - 3 kèm nhận xét chi tiết bằng tiếng Việt.
  - Đánh giá theo 3 tiêu chí: Mức độ liên quan đến tranh, Cách sử dụng từ gợi ý, Ngữ pháp.
  - Chỉ ra từng lỗi sai ngữ pháp và gợi ý câu điểm tối đa (Band 3).
- **Lưu trữ dữ liệu cục bộ (Offline-first):**
  - Đề bài, câu trả lời và lịch sử chấm thi được lưu trong IndexedDB cục bộ của ứng dụng tại thư mục `data`.
  - Không yêu cầu cài đặt máy chủ bên ngoài, không mở cổng mạng cục bộ.
- **Hỗ trợ AI đa dạng:** Hỗ trợ mọi endpoint chuẩn OpenAI-compatible (bao gồm OpenAI API và các router local như `9router`).
- **Phím tắt tiện lợi:** Hỗ trợ phím mũi tên `← / →` để chuyển câu, phím `Enter` để nộp bài (`Shift + Enter` xuống dòng).

---

## 🛠️ Yêu cầu hệ thống

- **Hệ điều hành:** Windows 10 (version 1809 trở lên) hoặc Windows 11 (64-bit).
- **Runtime:** Microsoft Edge WebView2 Runtime (đã tích hợp sẵn trên hầu hết các máy Windows 10/11 hiện đại).
- **Khi tự build từ mã nguồn:**
  - [.NET SDK 10.0+](https://dotnet.microsoft.com/download/dotnet/10.0)
  - [Node.js 20+](https://nodejs.org/) (để chạy bộ kiểm thử UI)
  - [Inno Setup 6](https://jrsoftware.org/isdl.php) (tùy chọn, để đóng gói file cài đặt installer)

---

## 🚀 Cài đặt & Khởi động nhanh

### 1. Dùng bản cài đặt có sẵn (Installer)
1. Tải file `MyTOEIC-Setup-1.0.0.exe` từ mục [Releases](../../releases).
2. Chạy file cài đặt (không yêu cầu quyền Administrator).
3. Mở ứng dụng từ shortcut trên Desktop hoặc Start Menu.

### 2. Chạy từ mã nguồn
```bash
# Clone repository
git clone https://github.com/torang295-pixel/practice-writing-toeic-part1.git
cd practice-writing-toeic-part1

# Restore & build solution
dotnet restore practice_toeic_writing_part1.sln
dotnet build practice_toeic_writing_part1.sln -c Release

# Chạy ứng dụng
dotnet run --project desktop/SentenceLab.Desktop.csproj -c Release
```

---

## ⚙️ Hướng dẫn cấu hình AI (9router / OpenAI)

1. Mở ứng dụng, bấm vào nút **Cấu hình AI** ở góc trên bên phải.
2. Thiết lập thông số:
   - **Base URL:** Đường dẫn API tương thích OpenAI (Ví dụ dùng 9router local: `http://localhost:20128/v1` hoặc `https://api.openai.com/v1`).
   - **Model:** Tên mô hình hỗ trợ Vision & JSON mode (Ví dụ: `gpt-4o-mini`, `gemini-2.5-flash`, `deepseek-chat`).
   - **API Key:** Khóa API tương ứng (với 9router local có thể điền `local`).
3. Bấm **Lưu cấu hình**. Cấu hình được ghi nhớ vĩnh viễn trên máy của bạn.

---


## 📂 Cấu trúc thư mục

```
practice_toeic_writing_part1/
├── .github/workflows/          # CI pipeline tự động build và test trên GitHub
├── assets/                     # Tài nguyên ứng dụng (app.ico)
├── desktop/                    # Mã nguồn C# WinForms native host + WebView2 wrapper
│   ├── AiService.cs            # Native HTTP client kết nối AI API
│   ├── MainForm.cs             # Cửa sổ chính, quản lý WebView2 & IPC
│   ├── Program.cs              # Entry point của ứng dụng
│   └── SentenceLab.Desktop.csproj
├── desktop.tests/              # Bộ Unit Test C# kiểm tra AI validation & parser
│   └── AiServiceTests.cs
├── installer/                  # Kịch bản đóng gói Inno Setup script
│   └── MyTOEIC.iss
├── pic/                        # Thư viện ảnh mẫu dùng để luyện thi TOEIC Part 1
├── tests/                      # Bộ kiểm thử giao diện WebView2 (ui.test.cjs)
├── app.js                      # Logic giao diện người dùng
├── build-desktop.ps1           # Script PowerShell tự động hóa build & packaging
├── index.html                  # Giao diện chính của ứng dụng
├── practice_toeic_writing_part1.sln   # Visual Studio Solution
├── style.css                   # Định dạng giao diện
├── package.json                # Định nghĩa lệnh test Node.js
└── README.md                   # Tài liệu hướng dẫn dự án
```

---

## 📄 Bản quyền (License)

Phát hành theo giấy phép [MIT License](LICENSE).
