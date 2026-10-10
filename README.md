# YHW Auto Solver — Extension tự động làm bài yourhomework.net

Tự động làm các bài trong `yourhomework.net/vocab/<id>/<hoạt động>`:
- **Q1–Q7 trắc nghiệm**: Từ→Hình, Hình→Từ, Từ→Nghĩa, Nghĩa→Từ, Nghe→Từ, Nghe→Hình, Nghe→Nghĩa (kể cả câu nghe — tự map audio qua API `tts/ensure`)
- **F1–F7 điền từ**: Hình/Nghĩa/Nghe → điền từ + tự bấm Kiểm tra
- **M1–M2 ghép cặp**: Từ–Nghĩa / Hình–Từ (mô phỏng kéo-thả, tự Kiểm tra, tự qua round)
- Các dạng game khác (U/V/O/C/W/H/G/S/T…): hiện bảng từ vựng để tự làm nhanh

Cách hoạt động: lấy ground-truth từ API công khai của chính trang
`/api/v1/vocab/<publicId>/activity-data` (chứa word–meaning–image), nhận diện
dạng prompt/option trên DOM, highlight đáp án xanh + auto-click giống người
(delay ngẫu nhiên), tự bấm "Câu tiếp theo".

## Cài đặt (Chrome / Edge / Brave / Cốc Cốc)

1. Tải thư mục `yhw-auto-solver` về máy.
2. Mở `chrome://extensions` → bật **Developer mode** (Chế độ nhà phát triển).
3. Bấm **Load unpacked** → chọn thư mục `yhw-auto-solver`.
4. Mở bài tập, ví dụ: https://yourhomework.net/vocab/954822131/q1
5. Panel **⚡ YHW Auto Solver** hiện ở góc phải dưới:
   - ☑ Tự động làm / Highlight đáp án / Tự qua câu tiếp theo
   - 🚀 **Siêu tốc**: delay ~0.1s mỗi bước (trắc nghiệm ~0.5s/câu, ghép cặp ~2s/round).
     Tắt đi để dùng delay tùy chỉnh (mặc định 500–1400ms cho giống người)
   - Nút **Giải câu này** (giải 1 câu ngay), **Từ vựng** (xem bảng word–meaning–hình)

## Kiểm chứng

- Logic đã test với API thật của bộ `954822131` (6 từ: good at, make decisions,
  notice, fixed, open to, electronic devices).
- Test live trên `/q1`: prompt `notice` → tìm đúng ảnh `...0351888932.jpg` (ô C).

## Lưu ý

- Đáp án lấy từ dữ liệu bài học công khai của trang, không can thiệp server.
- Dùng delay ngẫu nhiên + chỉ chạy trên `yourhomework.net/vocab/*`.
- Nếu site đổi class DOM (`yhw-quiz-option`, `yhw-fillin-input`…), báo để cập nhật selector.
