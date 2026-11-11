# TaskFlow — quản lý thực thi công việc cho nhóm phát triển phần mềm

Phạm vi: nhóm khoảng 5–20 người, một workspace có nhiều dự án. PM cần biết ai làm gì, tiến độ, chênh lệch kế hoạch, vấn đề gây trễ và ai quá tải. Developer/tester cập nhật việc mỗi ngày. PM/Member/Viewer là quyền theo dự án; Coding/Testing/Database là loại công việc; chức danh nghề nghiệp không tự cấp quyền.

## Điều hướng rút gọn — cập nhật 04/11/2026

Sidebar có 7 mục: Tổng quan, Bảng công việc, Việc của tôi, Tiến độ & lịch, Tải thành viên, Tài liệu và Trợ lý AI.

- Tổng quan có các tab Tổng quan, Báo cáo và Cảnh báo rủi ro.
- Tiến độ & lịch có các tab Lịch công việc, Kế hoạch & thực tế và Lịch họp.
- Báo cáo được truy cập từ Tổng quan; trang báo cáo không lặp lại dãy tab của Trợ lý AI. Các URL cũ tiếp tục hoạt động.
- Đã kiểm tra trực tiếp chuyển tab, sidebar tự đóng trên màn hình hẹp và tô sáng nhóm tương ứng. Build/typecheck/lint qua; 87/87 kiểm thử frontend qua. [Ảnh sidebar](screenshots/2026-11-04-compact-sidebar.png).

## Đối chiếu góp ý giảng viên

| Góp ý | Thực hiện trong sản phẩm |
| --- | --- |
| Đúng đối tượng và giải quyết công việc thực tế | README/SRS thống nhất nhóm phát triển phần mềm, quy trình giao việc → thực hiện → Review → PM duyệt Done |
| Một người có nhiều role ở nhiều dự án | Giữ project membership độc lập; trang Tải thành viên liệt kê quyền của người đó ở từng dự án được xem |
| Chia nhiều người thực hiện | Chi tiết task → Tiến độ & cộng tác → Phân bổ effort: người chính, người cùng thực hiện, trách nhiệm, giờ dự kiến/còn lại từng người và tỷ trọng |
| Task thuộc coding, database hay test | Loại chuẩn: Coding, Testing, Database, Design, Documentation, DevOps, Research; dữ liệu cũ có Chưa phân loại để PM rà soát |
| Ưu tiên rõ ràng | Kanban mặc định Cao → Trung bình → Thấp; có chế độ thứ tự thủ công; kéo trong cùng cột chỉ sắp xếp khi chọn thủ công |
| Bốn ngày | Ngày bắt đầu/kết thúc kế hoạch và thực tế; kiểm tra khoảng ngày; giữ dueDate là kết thúc kế hoạch |
| Hai thanh kế hoạch/thực tế | Trang Kế hoạch & thực tế và chi tiết task; chung thang ngày, màu riêng, chỉ báo sớm/trễ; thiếu ngày hiện rõ, không tự tạo ngày quá khứ |
| Effort một task | Tổng ước lượng, giờ nhật ký + số giờ trước đây, giờ còn lại; không lấy giờ đã làm chia ước lượng làm tiến độ |
| Cập nhật hằng ngày | Mỗi người/task/ngày một bản ghi: giờ, đã làm, tiếp theo, vướng mắc và % tiến độ; sửa thay bản ghi cũ, không cộng trùng |
| Biết issue, nguyên nhân trễ, mức độ | Vấn đề có mức nghiêm trọng, nguyên nhân, hướng xử lý, người xử lý, kết quả; đóng phải nhập kết quả; mở lại có kiểm quyền và version |
| Xem từng người và workload | Trang Tải thành viên: tuần, capacity, giờ còn lại, giờ đã ghi, việc chưa có hạn, danh sách task xuyên các dự án được xem và bốn ngày |
| Book lịch họp | Trang Lịch họp: người tham gia, thời gian, nội dung, địa điểm/link, đổi/hủy; kiểm tra xung đột người tham gia xuyên dự án |
| Ít thông tin, số căn phải | Nhóm chức năng chi tiết task đóng mặc định, mở theo nhu cầu; màn timeline/workload/journal căn phải số liệu, phân trang danh sách |

## Quy tắc và công thức

- **Tiến độ task** do người thực hiện/PM báo cáo trong nhật ký, từ 0–100%. Giờ đã làm không quyết định % hoàn thành. 100% chưa thay thế bước Review/PM duyệt Done. Done đặt tiến độ 100%; mở lại đưa về tối đa 99% để cập nhật lại. Task cha không ghi thêm nhật ký/phân bổ nếu có việc con đang tồn tại, tránh tính trùng effort. Tiến độ cha chưa tự suy từ phần trăm các việc con.
- **Ước lượng task** có phân bổ = tổng giờ dự kiến của các người cùng thực hiện. Tỷ trọng phân bổ = giờ dự kiến người đó / tổng dự kiến, không phải phần trăm hoàn thành hay đánh giá nhân sự. Người nhận chính phải có trong phân bổ. Task chưa chia dùng người nhận chính và giờ task hiện có.
- **Giờ đã làm** = `legacySpentHours + SUM(TaskDailyUpdate.hours)`. Migration giữ nguyên số giờ có trước khi thêm nhật ký; không gán số giờ lịch sử này cho bất kỳ cá nhân nào. Chỉ nhật ký mới có số giờ theo người. Khi đã có nhật ký, không ghi đè tổng giờ từ form task. Sửa cùng task/người/ngày thay giờ cũ; tổng một người không vượt 24 giờ/ngày, kể cả nhiều dự án/workspace. Tiến độ và giờ còn lại trên form nhật ký là cập nhật hiện trạng task, kể cả khi sửa nhật ký ngày cũ.
- **Giờ còn lại** task có phân bổ = tổng giờ còn lại từng người. Member sửa phần mình qua nhật ký; PM sửa phân bổ. Người được phân bổ cùng có quyền cập nhật tiến độ như người nhận chính. Member không được tự duyệt Done.
- **Tải tuần** = tổng giờ còn lại của người đó ở task lá chưa Done, dự án active, đến hạn trước cuối tuần, kế hoạch bắt đầu trước cuối tuần, bao gồm việc quá hạn chuyển sang. Chia cho capacity workspace/người/tuần, tính capacity một lần dù nhiều dự án. Không trải đều effort theo số ngày vì chưa có lịch làm việc chi tiết. Capacity = override tuần hoặc mặc định membership. 0 giờ khả dụng và còn việc: không có tỷ lệ hữu hạn, vẫn báo quá tải. Task chưa có hạn được báo riêng; kết quả không đủ để khẳng định người đó rảnh. Tuần capacity dùng thứ Hai, Asia/Ho_Chi_Minh.
- **Quyền riêng tư**: tổng hợp chỉ các dự án người đang xem có quyền đọc; không tuyên bố là tải toàn công ty nếu có dự án ngoài quyền. Dự án archived chỉ đọc. Thu hồi thành viên xóa phân bổ hiện tại, giữ nhật ký lịch sử.
- **Cuộc họp** tối đa 20 người gồm người đặt, không vượt 24 giờ, kết thúc sau bắt đầu; không đặt cuộc họp đã kết thúc trong quá khứ. Hai cuộc họp liền kề được phép. Lịch đã hủy không giữ chỗ. Xung đột trả thông báo chung, không lộ tiêu đề dự án riêng. Kiểm tra và ghi trong transaction có khóa theo người để chống hai lần đặt đồng thời. Thời gian nhập/hiển thị trên trang Lịch họp theo múi giờ thiết bị, ghi UTC trong DB.
- **Xung đột chỉnh sửa**: phân bổ/nhật ký/issue/cuộc họp có version. 409 yêu cầu tải dữ liệu mới; form không âm thầm ghi đè thay đổi của người khác. Nhật ký không cho ngày tương lai.

## Kịch bản demo cho giảng viên

1. Dùng PM tạo task “Kiểm thử đăng nhập”, loại Testing, ưu tiên Cao; nhập kế hoạch, mô tả và tiêu chí nghiệm thu cụ thể.
2. Mở Tiến độ & cộng tác, phân bổ 6 giờ viết test và 2 giờ review cho hai thành viên. Đổi tài khoản người cùng thực hiện: task xuất hiện trong Việc của tôi.
3. Ghi nhật ký 2 giờ, còn 4 giờ, tiến độ 30%; sửa thành 3 giờ và xác nhận tổng bằng 3, không phải 5.
4. Ghi vấn đề “Chờ API đối tác”, mức Cao, nguyên nhân và phương án mock; giao người xử lý, nhập kết quả rồi đóng.
5. Mở Kế hoạch & thực tế để đối chiếu hai thanh, không nhập ngày thực tế giả cho task chưa làm.
6. Mở Tải thành viên, chọn người để xem task và quyền khác nhau ở từng dự án; thay capacity tuần trong cài đặt để thấy quá tải.
7. Đặt cuộc họp hai người; đặt cuộc khác trùng người/giờ phải bị từ chối; đổi giờ hoặc hủy lịch cũ rồi đặt lại.
8. Member gửi Review, PM duyệt Done. Viewer chỉ xem; đổi sang dự án archived không được ghi.

## Kiểm chứng và giới hạn

Kiểm thử API trong `BackEnd/test/api.test.js`, suite “Nghiệp vụ nhóm phát triển”; kiểm thử trình duyệt trong `test/e2e/sprint1.test.mjs`, test “Nhóm phát triển”. Cả hai dùng DB tạm, không sửa dữ liệu dev. Ảnh kiểm thử được lưu tại `.data/e2e/delivery-task.png` và `delivery-meeting.png`.

Kết quả ngày 03/11/2026:

| Lần kiểm tra | Kết quả |
| --- | --- |
| `npm test` | AI 21/21, backend 205/205, frontend 86/86; không có test thất bại |
| Suite nghiệp vụ mới, bổ sung kiểm tra đồng thời sau lần chạy toàn bộ | 6/6; [log API](test-evidence/2026-11-03-team-delivery-api.txt) |
| Hồi quy thu hồi membership/quyền | 7/7; [log](test-evidence/2026-11-03-team-delivery-membership.txt) |
| Bổ sung thu hồi contributor và audit | 1/1; [log](test-evidence/2026-11-03-team-delivery-revocation.txt) |
| `npm run test:e2e`, lần chạy cuối | 11/11; [log trình duyệt](test-evidence/2026-11-03-team-delivery-e2e.txt) |
| `npm run build` (gồm typecheck), ESLint frontend | Qua; [log build](test-evidence/2026-11-03-team-delivery-build.txt) |
| Dịch vụ dev | Web 5173, API 4000 và AI 5000 trả HTTP 200 |

Bản build vẫn có cảnh báo Vite về bundle chính khoảng 509 kB trước gzip; đây chưa phải kết quả đo hiệu năng trên mạng/thiết bị người dùng thật. Lần chạy E2E cuối đã sửa bộ chờ response của test bốn ngày để nhận API v1. Test lỗi SMTP cố tình trả 503 để kiểm tra hành vi giữ form/thử lại, không phải lỗi gửi thư phát sinh ở môi trường dev.

Ảnh minh chứng: [chi tiết task](screenshots/2026-11-03-team-delivery-task.png), [lịch họp](screenshots/2026-11-03-team-delivery-meeting.png).

Đây là hoàn thiện chức năng trong phạm vi đồ án, chưa thay thế nghiệm thu với người dùng thật. Không đồng bộ Google/Outlook Calendar, không gửi lời mời email họp, không kiểm tra phòng họp, không quản lương hoặc tính phí. Chất lượng workload còn phụ thuộc việc nhập đủ hạn, ước lượng và cập nhật giờ còn lại. Bộ seed/dữ liệu có từ trước cần PM phân loại và cập nhật kế hoạch thực tế; hệ thống không tự bịa lịch sử làm việc.

Migration `20261102090000_team_delivery` thêm dữ liệu nghiệp vụ và giữ giờ lịch sử; `20261103090000_delivery_classification` đưa nhãn Coding mặc định của giai đoạn phát triển trước về Chưa phân loại để rà soát, không suy đoán loại công việc từ tiêu đề.
