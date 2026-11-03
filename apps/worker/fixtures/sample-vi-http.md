# Giao thức HTTP cho người mới bắt đầu

## 1. HTTP là gì

HTTP (HyperText Transfer Protocol — giao thức truyền siêu văn bản) là giao thức tầng ứng dụng mà trình duyệt và máy chủ web dùng để trao đổi dữ liệu. Mỗi lần bạn mở một trang web, trình duyệt gửi một hoặc nhiều yêu cầu HTTP tới máy chủ, và máy chủ trả lại các phản hồi HTTP chứa nội dung như HTML, CSS, JavaScript, hình ảnh hoặc dữ liệu JSON.

HTTP hoạt động theo mô hình yêu cầu – phản hồi (request – response). Bên gửi yêu cầu gọi là client (máy khách), thường là trình duyệt hoặc một ứng dụng di động. Bên trả lời gọi là server (máy chủ). Client luôn là bên chủ động mở đầu cuộc trao đổi; server chỉ trả lời khi nhận được yêu cầu.

Một đặc điểm quan trọng của HTTP là tính phi trạng thái (stateless). Server không tự nhớ gì về các yêu cầu trước đó của cùng một client. Mỗi yêu cầu phải tự mang đủ thông tin để server xử lý. Để "nhớ" người dùng giữa các yêu cầu, ứng dụng web phải dùng thêm cơ chế như cookie hoặc token gửi kèm trong mỗi yêu cầu.

HTTP thường chạy trên TCP, cổng mặc định là 80. Phiên bản bảo mật HTTPS mã hoá dữ liệu bằng TLS và dùng cổng mặc định 443. Với HTTPS, người đứng giữa đường truyền không đọc được nội dung yêu cầu và phản hồi, và trình duyệt có thể kiểm tra chứng chỉ để biết mình đang nói chuyện với đúng máy chủ.

## 2. Cấu trúc của một yêu cầu HTTP

Một yêu cầu HTTP gồm bốn phần: dòng yêu cầu, các header, một dòng trống và phần thân (body) tuỳ chọn.

Dòng yêu cầu chứa phương thức (method), đường dẫn tài nguyên và phiên bản giao thức, ví dụ `GET /products/42 HTTP/1.1`. Phương thức cho biết client muốn làm gì với tài nguyên; đường dẫn cho biết tài nguyên nào.

Header là các cặp tên – giá trị mang thông tin bổ sung. Header `Host` cho biết tên miền mà client muốn gọi, vì một máy chủ có thể phục vụ nhiều tên miền. Header `Content-Type` mô tả định dạng của phần thân, ví dụ `application/json`. Header `Authorization` mang thông tin xác thực như một access token. Header `Accept` cho biết client muốn nhận phản hồi ở định dạng nào.

Phần thân chứa dữ liệu gửi lên server. Yêu cầu GET thường không có phần thân, còn yêu cầu POST hoặc PUT thường mang dữ liệu JSON hoặc dữ liệu biểu mẫu trong phần thân.

## 3. Các phương thức HTTP phổ biến

GET dùng để lấy dữ liệu. Một yêu cầu GET không được làm thay đổi dữ liệu trên server, nên có thể gọi lại nhiều lần một cách an toàn. Trình duyệt và proxy có thể lưu đệm (cache) kết quả của GET.

POST dùng để tạo tài nguyên mới hoặc gửi dữ liệu để server xử lý, ví dụ gửi đơn đăng ký hay tải tệp lên. Gọi lại POST hai lần có thể tạo ra hai bản ghi, vì vậy POST không có tính luỹ đẳng.

PUT dùng để thay thế toàn bộ một tài nguyên bằng dữ liệu mới. PATCH dùng để sửa một phần tài nguyên. DELETE dùng để xoá tài nguyên.

Một phương thức được gọi là luỹ đẳng (idempotent) nếu gọi nó một lần hay nhiều lần đều cho cùng một trạng thái cuối trên server. GET, PUT và DELETE là luỹ đẳng; POST thì không. Tính chất này quan trọng khi mạng chập chờn: client có thể tự động gửi lại một yêu cầu luỹ đẳng mà không sợ tạo dữ liệu trùng.

## 4. Mã trạng thái phản hồi

Mỗi phản hồi HTTP bắt đầu bằng một dòng trạng thái chứa mã trạng thái gồm ba chữ số. Chữ số đầu tiên cho biết nhóm của phản hồi.

Nhóm 2xx báo thành công. Mã 200 OK nghĩa là yêu cầu được xử lý bình thường. Mã 201 Created nghĩa là một tài nguyên mới đã được tạo, thường là kết quả của POST. Mã 204 No Content nghĩa là thành công nhưng không có phần thân trả về.

Nhóm 3xx báo chuyển hướng. Mã 301 Moved Permanently cho biết tài nguyên đã chuyển hẳn sang địa chỉ mới, được ghi trong header `Location`. Mã 304 Not Modified cho biết bản lưu đệm của client vẫn còn dùng được.

Nhóm 4xx báo lỗi do phía client. Mã 400 Bad Request nghĩa là yêu cầu sai định dạng. Mã 401 Unauthorized nghĩa là client chưa xác thực. Mã 403 Forbidden nghĩa là client đã xác thực nhưng không có quyền. Mã 404 Not Found nghĩa là không tìm thấy tài nguyên. Mã 429 Too Many Requests nghĩa là client gửi quá nhiều yêu cầu trong một khoảng thời gian.

Nhóm 5xx báo lỗi do phía server. Mã 500 Internal Server Error là lỗi chung khi server gặp sự cố ngoài dự kiến. Mã 503 Service Unavailable nghĩa là server tạm thời không phục vụ được, ví dụ do quá tải hoặc đang bảo trì; client nên thử lại sau.

## 5. Cookie, phiên đăng nhập và token

Vì HTTP phi trạng thái, ứng dụng cần một cách để nhận ra người dùng đã đăng nhập. Cách truyền thống là cookie: server gửi header `Set-Cookie` trong phản hồi, trình duyệt lưu cookie đó và tự động gửi lại trong header `Cookie` ở mọi yêu cầu sau tới cùng tên miền.

Cookie có các thuộc tính bảo mật quan trọng. Thuộc tính `HttpOnly` ngăn JavaScript trên trang đọc cookie, giúp giảm thiệt hại khi trang bị tấn công XSS. Thuộc tính `Secure` bắt buộc cookie chỉ được gửi qua HTTPS. Thuộc tính `SameSite` hạn chế việc gửi cookie trong các yêu cầu bắt nguồn từ trang web khác, giúp chống tấn công CSRF.

Cách phổ biến khác là token, ví dụ access token dạng JWT. Client gửi token trong header `Authorization: Bearer <token>`. Access token thường có thời hạn ngắn; khi hết hạn, client dùng một refresh token có thời hạn dài hơn để xin access token mới mà không bắt người dùng đăng nhập lại.

## 6. Lưu đệm (cache) trong HTTP

Lưu đệm giúp giảm thời gian tải trang và giảm tải cho server bằng cách dùng lại phản hồi cũ thay vì tải lại. Server điều khiển việc lưu đệm bằng header `Cache-Control`. Giá trị `max-age=3600` cho phép dùng lại phản hồi trong 3600 giây. Giá trị `no-store` cấm lưu phản hồi, thường dùng cho dữ liệu nhạy cảm.

Khi bản lưu đệm đã cũ, client có thể hỏi lại server xem tài nguyên có thay đổi không thay vì tải lại toàn bộ. Server gửi kèm header `ETag` là một mã định danh phiên bản của tài nguyên. Ở lần sau, client gửi mã đó trong header `If-None-Match`. Nếu tài nguyên chưa đổi, server trả 304 Not Modified không kèm phần thân, và client dùng tiếp bản lưu đệm.
