import AVFoundation
import Capacitor
import UIKit

/// Bridge between the React replay screen and the native recorder (`ReplayRecorder`).
/// The camera preview is a native view laid over the web page at the rectangle the page reports.
@objc(BetaReplayPlugin)
public class BetaReplayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BetaReplayPlugin"
    public let jsName = "BetaReplay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveToPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteClip", returnType: CAPPluginReturnPromise),
    ]

    private let recorder = ReplayRecorder()
    private var preview: UIView?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    public override func load() {
        recorder.onEvent = { [weak self] name, data in
            var d = data; d["type"] = name
            self?.notifyListeners("replayEvent", data: d)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    @objc private func becameActive() { recorder.resumeIfNeeded() }

    private func info() -> [String: Any] {
        return ["resolution": recorder.resolution, "audio": recorder.withAudio, "zoomOptions": recorder.zoomOptions,
                "zoom": recorder.zoom, "lens": recorder.lensName, "codec": recorder.codecName,
                "buffered": recorder.buffered, "recording": recorder.recording]
    }

    @objc func start(_ call: CAPPluginCall) {
        let res = call.getInt("resolution") ?? 1080
        let audio = call.getBool("audio") ?? true
        recorder.start(resolution: res, audio: audio) { err in
            if let err = err { return call.reject(err.localizedDescription) }
            DispatchQueue.main.async { self.ensurePreview(); call.resolve(self.info()) }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        recorder.stop()
        DispatchQueue.main.async { self.preview?.isHidden = true; call.resolve() }
    }

    @objc func status(_ call: CAPPluginCall) {
        // the codec is known only after the first frame; ask again for it
        call.resolve(info())
    }

    @objc func save(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 60
        let toPhotos = call.getBool("toPhotos") ?? false
        recorder.save(seconds: seconds) { result in
            switch result {
            case .failure(let e): call.reject(e.localizedDescription)
            case .success(let clip):
                var out: [String: Any] = ["path": clip.url.path, "seconds": clip.seconds, "size": clip.size, "photos": false]
                if !toPhotos { return call.resolve(out) }
                ReplayRecorder.saveToPhotos(clip.url) { ok, msg in
                    out["photos"] = ok
                    if let msg = msg { out["photosError"] = msg }
                    call.resolve(out)
                }
            }
        }
    }

    @objc func setZoom(_ call: CAPPluginCall) {
        recorder.setZoom(call.getDouble("zoom") ?? 1) { err in
            if let err = err { call.reject(err.localizedDescription) } else { call.resolve(["zoom": self.recorder.zoom]) }
        }
    }

    /// x, y, width, height in page pixels (CSS px = points), visible
    @objc func setPreview(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? true
        let r = CGRect(x: call.getDouble("x") ?? 0, y: call.getDouble("y") ?? 0,
                       width: call.getDouble("width") ?? 0, height: call.getDouble("height") ?? 0)
        let radius = CGFloat(call.getDouble("radius") ?? 14)
        let clipTop = CGFloat(call.getDouble("clipTop") ?? -1e6)
        let clipBottom = CGFloat(call.getDouble("clipBottom") ?? 1e6)
        DispatchQueue.main.async {
            self.ensurePreview()
            guard let v = self.preview, let web = self.webView else { return call.resolve() }
            // only the part between the page's header and tab bar is shown; the picture itself doesn't move
            let band = CGRect(x: -1e6, y: clipTop, width: 2e6, height: max(0, clipBottom - clipTop))
            let shown = r.intersection(band)
            let origin = web.frame.origin
            CATransaction.begin(); CATransaction.setDisableActions(true)
            if shown.isNull || shown.height < 2 || r.width < 2 {
                v.isHidden = true
            } else {
                v.frame = shown.offsetBy(dx: origin.x, dy: origin.y)
                v.layer.cornerRadius = shown.height == r.height ? radius : 0
                self.previewLayer?.frame = CGRect(x: r.minX - shown.minX, y: r.minY - shown.minY, width: r.width, height: r.height)
                v.isHidden = !visible || !self.recorder.recording
            }
            CATransaction.commit()
            call.resolve()
        }
    }

    @objc func saveToPhotos(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { return call.reject("path") }
        ReplayRecorder.saveToPhotos(URL(fileURLWithPath: path)) { ok, msg in
            if ok { call.resolve(["photos": true]) } else { call.reject(msg ?? "사진첩에 저장하지 못했어요") }
        }
    }

    @objc func deleteClip(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { return call.reject("path") }
        try? FileManager.default.removeItem(atPath: path)
        call.resolve()
    }

    private func ensurePreview() {
        guard preview == nil, let host = bridge?.viewController?.view else { return }
        let v = UIView(frame: .zero)
        v.backgroundColor = .black
        v.clipsToBounds = true
        v.isUserInteractionEnabled = false
        v.isHidden = true
        let layer = AVCaptureVideoPreviewLayer(session: recorder.session)
        layer.videoGravity = .resizeAspectFill
        if let c = layer.connection, c.isVideoOrientationSupported { c.videoOrientation = .portrait }
        v.layer.addSublayer(layer)
        host.addSubview(v)
        preview = v; previewLayer = layer
    }
}
