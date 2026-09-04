import type { AppLanguage } from '../shared/contracts'

export interface Messages {
  tagline: string

  openSettings: string
  shortcutsTitle: string
  switchToDark: string
  switchToLight: string
  minimize: string
  restore: string
  maximize: string
  close: string

  pasteFromClipboardTitle: string
  pasteFromClipboard: string
  toggleManualInputTitle: string
  manualInput: string
  selectAll: string
  deselectAll: string
  all: string
  batchSettings: string
  applyToSelected: string
  applyToAllPending: string
  quality: string
  recommended: string
  allToMp3: string
  allToVideo: string
  mp3: string
  video: string
  format: string
  defaultVideoFormat: string
  resumeTitle: string
  pauseTitle: string
  startDownloadTitle: string
  download: string

  urlPlaceholder: string
  addToListTitle: string
  addToList: string

  downloadListAria: string
  readyToDownload: string
  emptySubtitle: string
  pressForShortcuts: (key: string) => string
  errorLabel: string
  tempErrorLabel: string
  loginToDownload: string
  reusedBadge: string
  reusedHint: string
  limitedData: string
  editFileNamePlaceholder: string
  fileNameTitle: string
  toMp3Title: string
  reloadMetadata: string
  renameFileTitle: string
  downloadNowTitle: string
  removeFromListTitle: string
  moveUp: string
  moveDown: string
  cancel: string
  open: string
  retryDownload: string
  retryDownloadTitle: string

  downloadingGroup: (n: number) => string
  pendingGroup: (n: number) => string
  completedGroup: (n: number) => string
  clearCompletedTitle: string
  clear: string

  paused: string
  downloadingStatus: string
  ready: string
  noItems: string
  countWaiting: (n: number) => string
  countDownloading: (n: number) => string
  countQueued: (n: number) => string
  countCompleted: (n: number) => string

  settings: string
  settingsSubtitle: string
  ytDlpReady: string
  offline: string
  notDetected: string
  updating: string
  updateYtDlp: string
  autoUpdateYtDlp: string
  forceH264: string
  forceH264Note: string
  recodeEncoderLabel: string
  recodeAuto: string
  recodeGpu: string
  recodeCpu: string
  recodeEncoderNote: string
  embedMetadata: string
  embedMetadataNote: string
  reuseDownloadedFiles: string
  reuseDownloadedFilesNote: string
  trimTitle: string
  trimStartPlaceholder: string
  trimEndPlaceholder: string
  trimHint: string
  clipLength: (len: string) => string
  trimReset: string
  updateSchedule: string
  weekly: string
  onStart: string
  lastAutoUpdate: (date: string) => string
  inUse: string
  formatLabel: string
  concurrentDownloads: string
  retries: string
  yourName: string
  yourNamePlaceholder: string
  secBasic: string
  secAccount: string
  secTools: string
  secReport: string
  reportBugDesc: string
  emailLabel: string
  emailPlaceholder: string
  bugMessage: string
  bugMessagePlaceholder: string
  sendBug: string
  sending: string
  bugSentTitle: string
  bugSentMsg: string
  invalidEmail: string
  outputDirTitle: string
  outputFolder: string
  chooseFolder: string
  language: string
  loginAccount: string
  login: string
  loggingIn: string
  logout: string
  loggedIn: string
  notLoggedIn: string
  loggedInNote: string
  authMode: string
  authModePublic: string
  authModeAuto: string
  authModeCookies: string
  authModeNote: string
  methodBrowserTitle: string
  methodBrowserDesc: string
  methodFileTitle: string
  methodFileDesc: string
  getExtension: string
  importCookies: string
  diagnostics: string
  diagnosticsSubtitle: string
  running: string
  runDiagnostics: string
  nodeLabel: string
  networkLabel: string
  networkLabelStatus: string
  networkOnline: string
  networkOffline: string
  serverLabel: string
  serverGood: string
  serverSlow: string
  serverVerySlow: string
  serverDown: string
  serverChecking: string
  generatedAt: string

  shortcutsModalTitle: string
  shortcutsSubtitle: string
  addLink: string
  startDownloadShort: string
  openSettingsShort: string
  closeModal: string
  showShortcuts: string

  levelSuccess: string
  levelError: string
  levelWarning: string
  levelInfo: string

  updateTitle: string
  updateDownloading: (percent: number) => string
  updateReady: (version: string) => string
  updateReadyDesc: string
  updateNow: string
  updateErrorTitle: string
  updateErrorDesc: string
  downloadManual: string
  updateDismiss: string
  retry: string

  profileBalanced: string
  profileBalancedDesc: string
  profileFast: string
  profileFastDesc: string
  profileSafe: string
  profileSafeDesc: string

  platformUnknown: string

  statusPending: string
  statusActive: string
  statusConnecting: string
  statusRecode: string
  statusAudioProcessing: string
  statusCopying: string
  statusCompleted: string
  statusFailed: string
  statusCancelled: string

  never: string

  appliedProfile: (label: string) => string
  appliedRecommendedQuality: (n: number) => string
  appliedQuality: (value: string, n: number) => string
  enabledMp3: (n: number) => string
  switchedToVideo: (n: number) => string
  readingMetadata: (source: string, n: number) => string
  metadataFailed: (detail: string) => string
  pasteAtLeastOne: string
  clipboardReadFailed: string
  clipboardNoLinks: string
  skippedDuplicates: (n: number) => string
  cannotDownload: string
  noItemsQueued: string
  addedToQueue: string
  addedItems: (n: number, rejectedSuffix: string) => string
  rejectedSuffix: (n: number) => string
  downloadError: string
  cannotAddToQueue: (detail: string) => string
  cannotOpenFolder: string
  cannotRetryDownload: string
  outputDirUpdated: string
  updateYtDlpFailed: (detail: string) => string
  queuePaused: string
  queueResumed: string
  cannotReorder: string
  diagnosticsNoIssues: string
  diagnosticsFoundIssues: string
  diagnosticsFailed: (detail: string) => string
  cannotMove: string

  importNewLinks: (source: string, n: number) => string
  importDuplicates: (n: number) => string
  importSkipped: (n: number) => string
  sourcePaste: string
  sourceClipboard: string

  errQualityUnavailable: string
  errInstagramNoMedia: string
  errVideoUnavailable: string
  errPrivateVideo: string
  errMembersOnly: string
  errAgeRestricted: string
  errLiveNotStarted: string
  errPremiere: string
  err429: string
  err403: string
  err404: string
  errGeo: string
  errCopyright: string
  errNetwork: string
  errExtract: string
  errFfmpegMissing: string
  errDiskFull: string
  errPermission: string
  errPlaylistEmpty: string
  errRequiresLogin: string
  errPublicOnly: string
  errQualityFallback: string
  errNoJsRuntime: string
  errSsl: string
  errServer5xx: string
  errUnsupportedUrl: string
  errGeneric: string
}

const vi: Messages = {
  tagline: 'Trình tải video chất lượng cao',

  openSettings: 'Mở cài đặt (Ctrl+,)',
  shortcutsTitle: 'Phím tắt (?)',
  switchToDark: 'Chuyển sang chế độ tối',
  switchToLight: 'Chuyển sang chế độ sáng',
  minimize: 'Thu nhỏ',
  restore: 'Khôi phục',
  maximize: 'Phóng to',
  close: 'Đóng',

  pasteFromClipboardTitle: 'Đọc link trực tiếp từ clipboard',
  pasteFromClipboard: 'Dán từ clipboard',
  toggleManualInputTitle: 'Hiện/ẩn ô nhập link thủ công',
  manualInput: 'Nhập tay',
  selectAll: 'Chọn tất cả',
  deselectAll: 'Bỏ chọn tất cả',
  all: 'Tất cả',
  batchSettings: 'Thiết lập hàng loạt',
  applyToSelected: 'Áp dụng cho mục đã chọn',
  applyToAllPending: 'Áp dụng cho toàn bộ mục chờ',
  quality: 'Chất lượng',
  recommended: 'Đề xuất',
  allToMp3: 'Chuyển tất cả sang MP3',
  allToVideo: 'Chuyển tất cả sang Video',
  mp3: 'MP3',
  video: 'Video',
  format: 'Format',
  defaultVideoFormat: 'Định dạng video mặc định',
  resumeTitle: 'Tiếp tục tải (Resume)',
  pauseTitle: 'Tạm dừng tải (Pause)',
  startDownloadTitle: 'Bắt đầu tải xuống (Ctrl+Shift+Enter)',
  download: 'Tải xuống',

  urlPlaceholder: 'Dán hoặc nhập link tại đây, mỗi link một dòng...',
  addToListTitle: 'Thêm link đã nhập vào danh sách (Ctrl+Enter)',
  addToList: 'Thêm vào danh sách',

  downloadListAria: 'Danh sách tải',
  readyToDownload: 'Sẵn sàng tải video',
  emptySubtitle: 'Dán link YouTube, TikTok, Facebook hoặc Instagram để bắt đầu',
  pressForShortcuts: (key: string) => `Nhấn ${key} để xem phím tắt`,
  errorLabel: 'Lỗi',
  tempErrorLabel: 'Tạm lỗi',
  loginToDownload: '🔑 Đăng nhập để tải',
  reusedBadge: 'Dùng lại',
  reusedHint: 'Đã có sẵn từ lần tải trước — sao chép sang thư mục lưu, không tải lại.',
  limitedData: 'Dữ liệu giới hạn',
  editFileNamePlaceholder: 'Chỉnh sửa tên file...',
  fileNameTitle: 'Tên file khi tải',
  toMp3Title: 'Chuyển sang MP3',
  reloadMetadata: 'Tải lại thông tin / chất lượng',
  renameFileTitle: 'Đổi tên file',
  downloadNowTitle: 'Tải ngay',
  removeFromListTitle: 'Xóa khỏi danh sách',
  moveUp: 'Di chuyển lên',
  moveDown: 'Di chuyển xuống',
  cancel: 'Hủy',
  open: 'Mở',
  retryDownload: 'Tải lại',
  retryDownloadTitle: 'Tải lại mục bị lỗi',

  downloadingGroup: (n) => `Đang tải (${n})`,
  pendingGroup: (n) => `Chờ (${n})`,
  completedGroup: (n) => `Hoàn tất (${n})`,
  clearCompletedTitle: 'Xóa các mục đã hoàn tất khỏi danh sách',
  clear: 'Xóa',

  paused: '⏸ Tạm dừng',
  downloadingStatus: '↓ Đang tải',
  ready: '● Sẵn sàng',
  noItems: 'Chưa có mục nào',
  countWaiting: (n) => `${n} chờ`,
  countDownloading: (n) => `${n} đang tải`,
  countQueued: (n) => `${n} xếp hàng`,
  countCompleted: (n) => `${n} hoàn tất`,

  settings: 'Cài đặt',
  settingsSubtitle: 'Điều khiển tải, yt-dlp và chẩn đoán',
  ytDlpReady: 'Sẵn sàng',
  offline: 'Ngoại tuyến',
  notDetected: 'Chưa phát hiện',
  updating: 'Đang cập nhật',
  updateYtDlp: 'Cập nhật yt-dlp',
  autoUpdateYtDlp: 'Tự cập nhật yt-dlp',
  forceH264: 'Tương thích Premiere (ép H.264 cho >1080p)',
  forceH264Note: 'Mặc định bật để file >1080p/4K import tốt vào Premiere/trình biên tập. Có thể tắt nếu ưu tiên tải nhanh và chỉ cần xem (giữ VP9/AV1).',
  recodeEncoderLabel: 'Bộ mã hóa khi re-encode',
  recodeAuto: 'Tự động (ưu tiên GPU)',
  recodeGpu: 'GPU (nhanh)',
  recodeCpu: 'CPU (chất lượng)',
  recodeEncoderNote: 'Khi ép H.264 cho file >1080p: GPU (NVENC/QSV) nhanh hơn nhiều với 4K; CPU (libx264) chậm hơn nhưng chất lượng/tương thích cao nhất. Tự động sẽ dùng GPU nếu máy hỗ trợ.',
  embedMetadata: 'Nhúng thumbnail + thông tin vào file',
  embedMetadataNote: 'Gắn ảnh thumbnail làm cover và thông tin (tiêu đề, kênh...) vào file tải về.',
  reuseDownloadedFiles: 'Dùng lại file đã tải',
  reuseDownloadedFilesNote: 'Khi bật, video cùng định dạng và chất lượng đã tải trước đó sẽ được dùng lại hoặc sao chép sang thư mục lưu mới. Tắt để luôn tải file mới.',
  trimTitle: 'Cắt đoạn (tải 1 khúc)',
  trimStartPlaceholder: 'Bắt đầu (vd 0:30.500)',
  trimEndPlaceholder: 'Kết thúc (vd 1:45.250)',
  trimHint: 'Kéo thanh hoặc gõ thời gian (đến mili giây). Để trống = từ đầu / đến hết.',
  clipLength: (len: string) => `Độ dài: ${len}`,
  trimReset: 'Xóa',
  updateSchedule: 'Lịch cập nhật',
  weekly: 'Hàng tuần',
  onStart: 'Khi mở app',
  lastAutoUpdate: (date) => `Lần tự cập nhật gần nhất: ${date}`,
  inUse: 'Đang dùng',
  formatLabel: 'Định dạng',
  concurrentDownloads: 'Tải song song',
  retries: 'Thử lại',
  yourName: 'Tên của bạn',
  yourNamePlaceholder: 'Nhập tên...',
  secBasic: 'Cơ bản',
  secAccount: 'Tài khoản',
  secTools: 'Công cụ',
  secReport: 'Báo lỗi',
  reportBugDesc: 'Gặp lỗi? Điền tên, email và mô tả lỗi để gửi cho nhà phát triển.',
  emailLabel: 'Email',
  emailPlaceholder: 'email@example.com',
  bugMessage: 'Mô tả lỗi',
  bugMessagePlaceholder: 'Bạn gặp lỗi gì, thao tác thế nào...',
  sendBug: 'Gửi báo lỗi',
  sending: 'Đang gửi...',
  bugSentTitle: 'Đã gửi',
  bugSentMsg: 'Cảm ơn! Báo lỗi đã được gửi.',
  invalidEmail: 'Email không hợp lệ',
  outputDirTitle: 'Đường dẫn lưu (chỉ đọc — có thể bôi đen để sao chép)',
  outputFolder: 'Thư mục lưu',
  chooseFolder: 'Chọn thư mục',
  language: 'Ngôn ngữ',
  loginAccount: 'Đăng nhập tài khoản',
  login: 'Đăng nhập',
  loggingIn: 'Đang mở...',
  logout: 'Đăng xuất',
  loggedIn: 'Đã lưu cookies',
  notLoggedIn: 'Chưa đăng nhập',
  loggedInNote: 'Đã lưu cookies đăng nhập. Chế độ Tự động sẽ chỉ dùng cookies khi link public không tải được.',
  authMode: 'Chế độ tải',
  authModePublic: 'Công khai (không cookies)',
  authModeAuto: 'Tự động dùng cookies khi cần',
  authModeCookies: 'Luôn dùng cookies',
  authModeNote: 'Mặc định Công khai để video public không bị lỗi do cookies cũ. Chọn Tự động hoặc Luôn dùng cookies cho nội dung cần đăng nhập.',
  methodBrowserTitle: 'Đăng nhập bằng Chrome/Edge',
  methodBrowserDesc: 'Mở trình duyệt thật với các tab YouTube, TikTok, Facebook, Instagram. Đăng nhập nền tảng nào bạn cần rồi đóng cửa sổ — app tự lưu cookies cho tất cả. Nhanh và tiện nhất.',
  methodFileTitle: 'Dùng file cookies.txt',
  methodFileDesc: 'Cách thủ công: cài tiện ích, xuất file cookies.txt từ trình duyệt rồi chọn file.',
  getExtension: 'Cài tiện ích Get cookies.txt LOCALLY',
  importCookies: 'Chọn file',
  diagnostics: 'Chẩn đoán',
  diagnosticsSubtitle: 'Kiểm tra yt-dlp, ffmpeg, thư mục lưu và mạng',
  running: 'Đang chạy',
  runDiagnostics: 'Chạy chẩn đoán',
  nodeLabel: 'Node.js',
  networkLabel: 'Mạng',
  networkLabelStatus: 'Mạng',
  networkOnline: 'Trực tuyến',
  networkOffline: 'Mất kết nối',
  serverLabel: 'Máy chủ tải',
  serverGood: 'Kết nối tốt',
  serverSlow: 'Kết nối chậm',
  serverVerySlow: 'Rất chậm',
  serverDown: 'Không kết nối được',
  serverChecking: 'Đang kiểm tra...',
  generatedAt: 'Thời điểm tạo',

  shortcutsModalTitle: '⌨️ Phím tắt',
  shortcutsSubtitle: 'Các phím tắt hữu ích để sử dụng nhanh',
  addLink: 'Thêm link',
  startDownloadShort: 'Bắt đầu tải',
  openSettingsShort: 'Mở cài đặt',
  closeModal: 'Đóng modal',
  showShortcuts: 'Hiện phím tắt',

  levelSuccess: 'Hoàn tất',
  levelError: 'Lỗi',
  levelWarning: 'Cảnh báo',
  levelInfo: 'Thông báo',

  updateTitle: 'Cập nhật bắt buộc',
  updateDownloading: (percent) => `Đang tải bản mới... ${percent}%`,
  updateReady: (version) => `Đã tải xong phiên bản ${version}`,
  updateReadyDesc: 'Cần cập nhật để tiếp tục sử dụng. Khởi động lại để hoàn tất.',
  updateNow: 'Cập nhật & khởi động lại',
  updateErrorTitle: 'Không tải được bản cập nhật',
  updateErrorDesc: 'Vui lòng tải bản mới thủ công để tiếp tục sử dụng.',
  downloadManual: 'Tải thủ công',
  updateDismiss: 'Tiếp tục dùng tạm',
  retry: 'Thử lại',

  profileBalanced: 'Cân bằng',
  profileBalancedDesc: 'Thiết lập ổn định cho hầu hết liên kết.',
  profileFast: 'Nhanh',
  profileFastDesc: 'Tăng số lượt tải song song, giảm số lần thử lại.',
  profileSafe: 'An toàn',
  profileSafeDesc: 'Tải chậm hơn, thử lại kỹ hơn khi mạng không ổn định.',

  platformUnknown: 'Không rõ',

  statusPending: 'Chờ tải',
  statusActive: 'Đang tải',
  statusConnecting: 'Đang kết nối',
  statusRecode: 'Đang chuyển mã',
  statusAudioProcessing: 'Đang xử lý audio',
  statusCopying: 'Đang sao chép',
  statusCompleted: 'Hoàn tất',
  statusFailed: 'Lỗi',
  statusCancelled: 'Đã hủy',

  never: 'Never',

  appliedProfile: (label) => `Đã áp dụng hồ sơ ${label}.`,
  appliedRecommendedQuality: (n) => `Đã chọn chất lượng đề xuất cho ${n} mục.`,
  appliedQuality: (value, n) => `Đã đặt ${value} cho ${n} mục.`,
  enabledMp3: (n) => `Đã bật MP3 cho ${n} mục.`,
  switchedToVideo: (n) => `Đã chuyển ${n} mục về video.`,
  readingMetadata: (source, n) => `${source}: đang đọc metadata cho ${n} link`,
  metadataFailed: (detail) => `Đọc metadata thất bại: ${detail}`,
  pasteAtLeastOne: 'Dán ít nhất một URL được hỗ trợ.',
  clipboardReadFailed: 'Không đọc được clipboard.',
  clipboardNoLinks: 'Clipboard không có link được hỗ trợ.',
  skippedDuplicates: (n) => `Bỏ qua ${n} link trùng đã có trong hàng đợi hoặc lịch sử.`,
  cannotDownload: 'Không thể tải',
  noItemsQueued: 'Chưa có mục nào được đưa vào hàng đợi.',
  addedToQueue: 'Đã thêm vào hàng đợi',
  addedItems: (n, suffix) => `${n} mục đã được thêm${suffix}`,
  rejectedSuffix: (n) => ` · ${n} bị từ chối`,
  downloadError: 'Lỗi tải xuống',
  cannotAddToQueue: (detail) => `Không thể thêm vào hàng đợi: ${detail}`,
  cannotOpenFolder: 'Không thể mở thư mục lưu. Hãy kiểm tra lại file hoặc thư mục đầu ra.',
  cannotRetryDownload: 'Không thể tải lại mục này. Có thể cùng biến thể đang chờ hoặc đang tải.',
  outputDirUpdated: 'Đã cập nhật thư mục lưu.',
  updateYtDlpFailed: (detail) => `Cập nhật yt-dlp thất bại: ${detail}`,
  queuePaused: 'Đã tạm dừng hàng đợi.',
  queueResumed: 'Đã tiếp tục hàng đợi.',
  cannotReorder: 'Chưa thể sắp xếp lại mục này.',
  diagnosticsNoIssues: 'Chẩn đoán không phát hiện lỗi.',
  diagnosticsFoundIssues: 'Chẩn đoán phát hiện vấn đề cần kiểm tra.',
  diagnosticsFailed: (detail) => `Chẩn đoán thất bại: ${detail}`,
  cannotMove: 'Chưa thể di chuyển lượt tải này.',

  importNewLinks: (source, n) => `${source}: ${n} link mới`,
  importDuplicates: (n) => `${n} trùng`,
  importSkipped: (n) => `${n} bỏ qua`,
  sourcePaste: 'Dán',
  sourceClipboard: 'Clipboard',

  errQualityUnavailable: 'Chất lượng đã chọn không khả dụng.',
  errInstagramNoMedia: 'Instagram không trả về dữ liệu media công khai.',
  errVideoUnavailable: 'Video không khả dụng (đã xóa hoặc bị giới hạn).',
  errPrivateVideo: 'Video ở chế độ riêng tư.',
  errMembersOnly: 'Video chỉ dành cho thành viên kênh.',
  errAgeRestricted: 'Video bị giới hạn độ tuổi — cần đăng nhập.',
  errLiveNotStarted: 'Livestream chưa bắt đầu hoặc chưa lưu lại.',
  errPremiere: 'Video premiere chưa phát.',
  err429: 'Bị giới hạn truy cập (429) — thử lại sau ít phút.',
  err403: 'Nguồn tải bị từ chối tạm thời (403). Hãy Tải lại; nếu vẫn lỗi, dùng chế độ Tự động/cookies.',
  err404: 'URL không tồn tại (404).',
  errGeo: 'Bị chặn theo vùng địa lý.',
  errCopyright: 'Video đã bị gỡ (bản quyền hoặc do người đăng).',
  errNetwork: 'Lỗi mạng — kiểm tra kết nối Internet.',
  errExtract: 'Không trích xuất được video từ URL này.',
  errFfmpegMissing: 'Thiếu ffmpeg — cài đặt và thêm vào PATH.',
  errDiskFull: 'Hết dung lượng ổ đĩa.',
  errPermission: 'Không có quyền ghi vào thư mục lưu.',
  errPlaylistEmpty: 'Playlist rỗng hoặc không truy cập được.',
  errRequiresLogin: 'Nội dung này cần đăng nhập hoặc cookies (app chỉ hỗ trợ nội dung công khai).',
  errPublicOnly: 'Nội dung không khả dụng ở chế độ công khai (riêng tư, đã xóa hoặc bị giới hạn).',
  errQualityFallback: 'Chất lượng/định dạng yêu cầu không có. Hãy thử MP4 với chất lượng Auto.',
  errNoJsRuntime: 'Thiếu môi trường JavaScript (Node.js) mà yt-dlp cần.',
  errSsl: 'Lỗi chứng chỉ SSL — kiểm tra ngày giờ hệ thống hoặc kết nối mạng.',
  errServer5xx: 'Máy chủ nguồn đang lỗi — thử lại sau.',
  errUnsupportedUrl: 'Link không được hỗ trợ hoặc không hợp lệ.',
  errGeneric: 'Không tải được video. Link có thể không hợp lệ, bị giới hạn khu vực, riêng tư hoặc cần đăng nhập.',
}

const en: Messages = {
  tagline: 'High-quality video downloader',

  openSettings: 'Open settings (Ctrl+,)',
  shortcutsTitle: 'Keyboard shortcuts (?)',
  switchToDark: 'Switch to dark mode',
  switchToLight: 'Switch to light mode',
  minimize: 'Minimize',
  restore: 'Restore',
  maximize: 'Maximize',
  close: 'Close',

  pasteFromClipboardTitle: 'Read links directly from clipboard',
  pasteFromClipboard: 'Paste from clipboard',
  toggleManualInputTitle: 'Show/hide manual link input',
  manualInput: 'Manual input',
  selectAll: 'Select all',
  deselectAll: 'Deselect all',
  all: 'All',
  batchSettings: 'Batch settings',
  applyToSelected: 'Apply to selected items',
  applyToAllPending: 'Apply to all pending items',
  quality: 'Quality',
  recommended: 'Recommended',
  allToMp3: 'Convert all to MP3',
  allToVideo: 'Convert all to Video',
  mp3: 'MP3',
  video: 'Video',
  format: 'Format',
  defaultVideoFormat: 'Default video format',
  resumeTitle: 'Resume downloads',
  pauseTitle: 'Pause downloads',
  startDownloadTitle: 'Start download (Ctrl+Shift+Enter)',
  download: 'Download',

  urlPlaceholder: 'Paste or type links here, one per line...',
  addToListTitle: 'Add entered links to the list (Ctrl+Enter)',
  addToList: 'Add to list',

  downloadListAria: 'Download list',
  readyToDownload: 'Ready to download videos',
  emptySubtitle: 'Paste a YouTube, TikTok, Facebook or Instagram link to begin',
  pressForShortcuts: (key: string) => `Press ${key} for keyboard shortcuts`,
  errorLabel: 'Error',
  tempErrorLabel: 'Temporary error',
  loginToDownload: '🔑 Log in to download',
  reusedBadge: 'Reused',
  reusedHint: 'Already downloaded before — copied to your save folder instead of re-downloading.',
  limitedData: 'Limited data',
  editFileNamePlaceholder: 'Edit file name...',
  fileNameTitle: 'File name when downloaded',
  toMp3Title: 'Switch to MP3',
  reloadMetadata: 'Reload info / quality',
  renameFileTitle: 'Rename file',
  downloadNowTitle: 'Download now',
  removeFromListTitle: 'Remove from list',
  moveUp: 'Move up',
  moveDown: 'Move down',
  cancel: 'Cancel',
  open: 'Open',
  retryDownload: 'Retry',
  retryDownloadTitle: 'Retry this failed download',

  downloadingGroup: (n) => `Downloading (${n})`,
  pendingGroup: (n) => `Pending (${n})`,
  completedGroup: (n) => `Completed (${n})`,
  clearCompletedTitle: 'Remove completed items from the list',
  clear: 'Clear',

  paused: '⏸ Paused',
  downloadingStatus: '↓ Downloading',
  ready: '● Ready',
  noItems: 'No items yet',
  countWaiting: (n) => `${n} waiting`,
  countDownloading: (n) => `${n} downloading`,
  countQueued: (n) => `${n} queued`,
  countCompleted: (n) => `${n} completed`,

  settings: 'Settings',
  settingsSubtitle: 'Download, yt-dlp and diagnostics controls',
  ytDlpReady: 'Ready',
  offline: 'Offline',
  notDetected: 'Not detected',
  updating: 'Updating',
  updateYtDlp: 'Update yt-dlp',
  autoUpdateYtDlp: 'Auto-update yt-dlp',
  forceH264: 'Editor-compatible (re-encode >1080p to H.264)',
  forceH264Note: 'Enabled by default so >1080p/4K imports cleanly into Premiere/editors. Turn off when download speed matters more and you only need playback (keeps VP9/AV1).',
  recodeEncoderLabel: 'Re-encode with',
  recodeAuto: 'Auto (prefer GPU)',
  recodeGpu: 'GPU (fast)',
  recodeCpu: 'CPU (quality)',
  recodeEncoderNote: 'When re-encoding >1080p to H.264: GPU (NVENC/QSV) is far faster for 4K; CPU (libx264) is slower but highest quality/compatibility. Auto uses the GPU when your machine supports it.',
  embedMetadata: 'Embed thumbnail + metadata into file',
  embedMetadataNote: 'Attaches the thumbnail as cover art and writes info (title, uploader...) into the downloaded file.',
  reuseDownloadedFiles: 'Reuse previously downloaded files',
  reuseDownloadedFilesNote: 'When enabled, matching videos already downloaded are reused or copied into the new output folder. Turn off to always download a fresh file.',
  trimTitle: 'Trim (download a clip)',
  trimStartPlaceholder: 'Start (e.g. 0:30.500)',
  trimEndPlaceholder: 'End (e.g. 1:45.250)',
  trimHint: 'Drag the bar or type a time (millisecond precise). Blank = from start / to end.',
  clipLength: (len: string) => `Length: ${len}`,
  trimReset: 'Reset',
  updateSchedule: 'Update schedule',
  weekly: 'Weekly',
  onStart: 'On app start',
  lastAutoUpdate: (date) => `Last auto-update: ${date}`,
  inUse: 'In use',
  formatLabel: 'Format',
  concurrentDownloads: 'Concurrent downloads',
  retries: 'Retries',
  yourName: 'Your name',
  yourNamePlaceholder: 'Enter name...',
  secBasic: 'Basics',
  secAccount: 'Account',
  secTools: 'Tools',
  secReport: 'Report a bug',
  reportBugDesc: 'Hit a bug? Enter your name, email and a description to send it to the developer.',
  emailLabel: 'Email',
  emailPlaceholder: 'email@example.com',
  bugMessage: 'Bug description',
  bugMessagePlaceholder: 'What went wrong, what you did...',
  sendBug: 'Send report',
  sending: 'Sending...',
  bugSentTitle: 'Sent',
  bugSentMsg: 'Thanks! Your report was sent.',
  invalidEmail: 'Invalid email',
  outputDirTitle: 'Output path (read-only — select to copy)',
  outputFolder: 'Output folder',
  chooseFolder: 'Choose folder',
  language: 'Language',
  loginAccount: 'Account login',
  login: 'Log in',
  loggingIn: 'Opening...',
  logout: 'Log out',
  loggedIn: 'Cookies saved',
  notLoggedIn: 'Not logged in',
  loggedInNote: 'Login cookies saved. Auto mode only uses them when a public download cannot continue.',
  authMode: 'Download mode',
  authModePublic: 'Public (no cookies)',
  authModeAuto: 'Auto cookies when needed',
  authModeCookies: 'Always use cookies',
  authModeNote: 'Public is the default so stale cookies cannot break public videos. Use Auto or Always for sign-in-only content.',
  methodBrowserTitle: 'Log in with Chrome/Edge',
  methodBrowserDesc: 'Opens a real browser with tabs for YouTube, TikTok, Facebook, and Instagram. Sign in to whichever you need, close the window, and the app saves cookies for all of them. Fastest and easiest.',
  methodFileTitle: 'Use a cookies.txt file',
  methodFileDesc: 'Manual way: install the extension, export cookies.txt from your browser, then pick the file.',
  getExtension: 'Install Get cookies.txt LOCALLY',
  importCookies: 'Pick file',
  diagnostics: 'Diagnostics',
  diagnosticsSubtitle: 'Check yt-dlp, ffmpeg, output folder and network',
  running: 'Running',
  runDiagnostics: 'Run diagnostics',
  nodeLabel: 'Node.js',
  networkLabel: 'Network',
  networkLabelStatus: 'Network',
  networkOnline: 'Online',
  networkOffline: 'Offline',
  serverLabel: 'Download server',
  serverGood: 'Good connection',
  serverSlow: 'Slow connection',
  serverVerySlow: 'Very slow',
  serverDown: 'Cannot connect',
  serverChecking: 'Checking...',
  generatedAt: 'Generated at',

  shortcutsModalTitle: '⌨️ Keyboard shortcuts',
  shortcutsSubtitle: 'Handy shortcuts for faster use',
  addLink: 'Add link',
  startDownloadShort: 'Start download',
  openSettingsShort: 'Open settings',
  closeModal: 'Close modal',
  showShortcuts: 'Show shortcuts',

  levelSuccess: 'Completed',
  levelError: 'Error',
  levelWarning: 'Warning',
  levelInfo: 'Notice',

  updateTitle: 'Required update',
  updateDownloading: (percent) => `Downloading update... ${percent}%`,
  updateReady: (version) => `Version ${version} downloaded`,
  updateReadyDesc: 'You must update to keep using the app. Restart to finish.',
  updateNow: 'Update & restart',
  updateErrorTitle: 'Update download failed',
  updateErrorDesc: 'Please download the new version manually to continue.',
  downloadManual: 'Download manually',
  updateDismiss: 'Continue for now',
  retry: 'Retry',

  profileBalanced: 'Balanced',
  profileBalancedDesc: 'Stable settings for most links.',
  profileFast: 'Fast',
  profileFastDesc: 'More parallel downloads, fewer retries.',
  profileSafe: 'Safe',
  profileSafeDesc: 'Slower downloads, more retries when the network is unstable.',

  platformUnknown: 'Unknown',

  statusPending: 'Pending',
  statusActive: 'Downloading',
  statusConnecting: 'Connecting',
  statusRecode: 'Re-encoding',
  statusAudioProcessing: 'Processing audio',
  statusCopying: 'Copying',
  statusCompleted: 'Completed',
  statusFailed: 'Error',
  statusCancelled: 'Cancelled',

  never: 'Never',

  appliedProfile: (label) => `Applied the ${label} profile.`,
  appliedRecommendedQuality: (n) => `Set recommended quality for ${n} item(s).`,
  appliedQuality: (value, n) => `Set ${value} for ${n} item(s).`,
  enabledMp3: (n) => `Enabled MP3 for ${n} item(s).`,
  switchedToVideo: (n) => `Switched ${n} item(s) back to video.`,
  readingMetadata: (source, n) => `${source}: reading metadata for ${n} link(s)`,
  metadataFailed: (detail) => `Failed to read metadata: ${detail}`,
  pasteAtLeastOne: 'Paste at least one supported URL.',
  clipboardReadFailed: 'Could not read the clipboard.',
  clipboardNoLinks: 'The clipboard has no supported links.',
  skippedDuplicates: (n) => `Skipped ${n} duplicate link(s) already in the queue or history.`,
  cannotDownload: 'Cannot download',
  noItemsQueued: 'No items were added to the queue.',
  addedToQueue: 'Added to queue',
  addedItems: (n, suffix) => `${n} item(s) added${suffix}`,
  rejectedSuffix: (n) => ` · ${n} rejected`,
  downloadError: 'Download error',
  cannotAddToQueue: (detail) => `Could not add to queue: ${detail}`,
  cannotOpenFolder: 'Could not open the output folder. Please check the file or output directory.',
  cannotRetryDownload: 'Could not retry this item. The same variant may already be queued or downloading.',
  outputDirUpdated: 'Output folder updated.',
  updateYtDlpFailed: (detail) => `Failed to update yt-dlp: ${detail}`,
  queuePaused: 'Queue paused.',
  queueResumed: 'Queue resumed.',
  cannotReorder: 'Could not reorder this item.',
  diagnosticsNoIssues: 'Diagnostics found no issues.',
  diagnosticsFoundIssues: 'Diagnostics found issues to check.',
  diagnosticsFailed: (detail) => `Diagnostics failed: ${detail}`,
  cannotMove: 'Could not move this download.',

  importNewLinks: (source, n) => `${source}: ${n} new link(s)`,
  importDuplicates: (n) => `${n} duplicate`,
  importSkipped: (n) => `${n} skipped`,
  sourcePaste: 'Paste',
  sourceClipboard: 'Clipboard',

  errQualityUnavailable: 'The selected quality is not available.',
  errInstagramNoMedia: 'Instagram did not return public media data.',
  errVideoUnavailable: 'Video unavailable (deleted or restricted).',
  errPrivateVideo: 'This video is private.',
  errMembersOnly: 'This video is for channel members only.',
  errAgeRestricted: 'Age-restricted video — sign-in required.',
  errLiveNotStarted: 'The livestream has not started or was not saved.',
  errPremiere: 'The premiere has not aired yet.',
  err429: 'Rate limited (429) — try again in a few minutes.',
  err403: 'The media source was temporarily rejected (403). Retry; if it persists, use Auto/cookies mode.',
  err404: 'The URL does not exist (404).',
  errGeo: 'Blocked in your region.',
  errCopyright: 'The video was removed (copyright or by the uploader).',
  errNetwork: 'Network error — check your Internet connection.',
  errExtract: 'Could not extract a video from this URL.',
  errFfmpegMissing: 'ffmpeg is missing — install it and add it to PATH.',
  errDiskFull: 'The disk is full.',
  errPermission: 'No permission to write to the output folder.',
  errPlaylistEmpty: 'The playlist is empty or inaccessible.',
  errRequiresLogin: 'This content requires sign-in or cookies (the app supports public content only).',
  errPublicOnly: 'Content unavailable in public-only mode (private, deleted or restricted).',
  errQualityFallback: 'The requested quality/format is unavailable. Try MP4 with Auto quality.',
  errNoJsRuntime: 'Missing the JavaScript runtime (Node.js) that yt-dlp needs.',
  errSsl: 'SSL certificate error — check the system date/time or your network.',
  errServer5xx: 'The source server is erroring — try again later.',
  errUnsupportedUrl: 'The link is unsupported or invalid.',
  errGeneric: 'Could not download the video. The link may be invalid, region-restricted, private or require sign-in.',
}

export function getMessages(language: AppLanguage | undefined): Messages {
  return language === 'en' ? en : vi
}
