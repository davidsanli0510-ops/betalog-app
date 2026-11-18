import AVFoundation
import Photos
import UIKit
import UniformTypeIdentifiers

/// Always-on recorder with a rolling buffer, using the iPhone camera directly (full camera quality:
/// stabilisation, HDR, every lens). The encoder writes fragmented MP4 in 1-second pieces
/// (AVAssetWriter's HLS output); the pieces of the last ~2 minutes are kept as files and older ones
/// deleted. Saving joins the pieces and trims them to the asked length without re-encoding.
public final class ReplayRecorder: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate,
                                   AVCaptureAudioDataOutputSampleBufferDelegate, AVAssetWriterDelegate {

    public struct Clip { public let url: URL; public let seconds: Double; public let size: Int }
    struct Piece { let url: URL; let start: Double; let duration: Double }

    public let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "betalog.replay.session")
    private let dataQueue = DispatchQueue(label: "betalog.replay.data")
    private let lock = NSLock()

    private var device: AVCaptureDevice?
    private let videoOut = AVCaptureVideoDataOutput()
    private let audioOut = AVCaptureAudioDataOutput()

    // writer state (dataQueue)
    private var writer: AVAssetWriter?
    private var videoIn: AVAssetWriterInput?
    private var audioIn: AVAssetWriterInput?
    private var startPTS = CMTime.invalid

    // buffer (lock)
    private var initSegment: Data?
    private var pieces: [Piece] = []
    private var pieceNo = 0

    private let dir: URL
    private let clipsDir: URL
    /// seconds kept: the longest save (2 min) plus a little slack
    public var maxLength: Double = 125
    public private(set) var recording = false
    public private(set) var resolution = 1080
    public private(set) var withAudio = true
    public private(set) var zoomOptions: [Double] = [1]
    public private(set) var zoom: Double = 1
    public private(set) var lensName = ""
    public private(set) var codecName = ""
    private var zoomBase: CGFloat = 1

    /// "interrupted" / "resumed" / "error" with details, delivered on the main queue
    public var onEvent: ((String, [String: Any]) -> Void)?

    public override init() {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("replay", isDirectory: true)
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dir = tmp
        clipsDir = docs.appendingPathComponent("clips", isDirectory: true)
        super.init()
        try? FileManager.default.removeItem(at: tmp)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: clipsDir, withIntermediateDirectories: true)
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(interrupted), name: .AVCaptureSessionWasInterrupted, object: session)
        nc.addObserver(self, selector: #selector(interruptionEnded), name: .AVCaptureSessionInterruptionEnded, object: session)
        nc.addObserver(self, selector: #selector(runtimeError), name: .AVCaptureSessionRuntimeError, object: session)
    }

    // MARK: - start / stop

    public enum StartError: LocalizedError {
        case cameraDenied, noCamera, cannotConfigure(String)
        public var errorDescription: String? {
            switch self {
            case .cameraDenied: return "카메라 권한이 꺼져 있어요. 설정 → 베타로그에서 카메라를 허용해 주세요."
            case .noCamera: return "카메라를 찾지 못했어요."
            case .cannotConfigure(let m): return "카메라를 준비하지 못했어요. (\(m))"
            }
        }
    }

    public func start(resolution: Int, audio: Bool, completion: @escaping (Error?) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { ok in
            guard ok else { return DispatchQueue.main.async { completion(StartError.cameraDenied) } }
            let go = { (micOK: Bool) in
                self.sessionQueue.async {
                    do {
                        try self.configure(resolution: resolution, audio: audio && micOK)
                        self.resetBuffer()
                        self.recording = true
                        if !self.session.isRunning { self.session.startRunning() }
                        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true; completion(nil) }
                    } catch {
                        DispatchQueue.main.async { completion(error) }
                    }
                }
            }
            if audio { AVCaptureDevice.requestAccess(for: .audio) { go($0) } } else { go(false) }
        }
    }

    public func stop() {
        sessionQueue.async {
            self.recording = false
            if self.session.isRunning { self.session.stopRunning() }
            self.resetBuffer()
            DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false }
        }
    }

    /// back camera that can switch lenses by zoom (triple / dual-wide / dual), else the wide one
    private func pickDevice() -> AVCaptureDevice? {
        let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
        for t in types {
            if let d = AVCaptureDevice.DiscoverySession(deviceTypes: [t], mediaType: .video, position: .back).devices.first { return d }
        }
        return AVCaptureDevice.default(for: .video)
    }

    private func configure(resolution: Int, audio: Bool) throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.inputs.forEach { session.removeInput($0) }
        session.outputs.forEach { session.removeOutput($0) }

        guard let dev = pickDevice() else { throw StartError.noCamera }
        device = dev
        let input = try AVCaptureDeviceInput(device: dev)
        guard session.canAddInput(input) else { throw StartError.cannotConfigure("input") }
        session.addInput(input)

        let wanted: [(Int, AVCaptureSession.Preset)] = [(2160, .hd4K3840x2160), (1080, .hd1920x1080), (720, .hd1280x720)]
        let usable = wanted.filter { $0.0 <= resolution && session.canSetSessionPreset($0.1) }
        let chosen = usable.first ?? (720, .high)
        session.sessionPreset = chosen.1
        self.resolution = chosen.0

        withAudio = false
        if audio, let mic = AVCaptureDevice.default(for: .audio), let micIn = try? AVCaptureDeviceInput(device: mic), session.canAddInput(micIn) {
            session.addInput(micIn)
            withAudio = true
        }

        videoOut.alwaysDiscardsLateVideoFrames = true
        videoOut.setSampleBufferDelegate(self, queue: dataQueue)
        guard session.canAddOutput(videoOut) else { throw StartError.cannotConfigure("video output") }
        session.addOutput(videoOut)
        if let c = videoOut.connection(with: .video), c.isVideoStabilizationSupported {
            c.preferredVideoStabilizationMode = .auto
        }
        if withAudio {
            audioOut.setSampleBufferDelegate(self, queue: dataQueue)
            if session.canAddOutput(audioOut) { session.addOutput(audioOut) } else { withAudio = false }
        }

        // zoom steps like the Camera app: 0.5× is the ultra-wide lens (zoom factor 1 on these virtual cameras)
        let switchOver = dev.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        let hasUltra = dev.deviceType == .builtInTripleCamera || dev.deviceType == .builtInDualWideCamera
        zoomBase = hasUltra ? (switchOver.first ?? 2) : 1
        let maxFactor = min(dev.maxAvailableVideoZoomFactor, dev.activeFormat.videoMaxZoomFactor, zoomBase * 10)
        var opts: [Double] = hasUltra ? [0.5, 1, 2] : [1, 2]
        if switchOver.count > 1 { opts.append(Double(switchOver[1] / zoomBase)) } // telephoto (3× or 5×)
        else if dev.deviceType == .builtInDualCamera, let t = switchOver.first { opts.append(Double(t)) }
        zoomOptions = Array(Set(opts.map { ($0 * 10).rounded() / 10 })).filter { CGFloat($0) * zoomBase <= maxFactor + 0.01 }.sorted()
        lensName = dev.localizedName
        try applyZoom(1)
    }

    private func applyZoom(_ z: Double) throws {
        guard let dev = device else { return }
        try dev.lockForConfiguration()
        let f = max(dev.minAvailableVideoZoomFactor, min(CGFloat(z) * zoomBase, dev.maxAvailableVideoZoomFactor))
        dev.videoZoomFactor = f
        dev.unlockForConfiguration()
        zoom = z
    }

    /// changes lens/zoom on the running camera; the buffer keeps going
    public func setZoom(_ z: Double, completion: @escaping (Error?) -> Void) {
        sessionQueue.async {
            do { try self.applyZoom(z); DispatchQueue.main.async { completion(nil) } }
            catch { DispatchQueue.main.async { completion(error) } }
        }
    }

    // MARK: - buffer

    public var buffered: Double {
        lock.lock(); defer { lock.unlock() }
        return pieces.reduce(0) { $0 + $1.duration }
    }

    /// drops the writer and every buffered piece (new camera settings, or a gap in the recording)
    private func resetBuffer() {
        dataQueue.async {
            self.writer?.cancelWriting()
            self.writer = nil; self.videoIn = nil; self.audioIn = nil; self.startPTS = .invalid
            self.lock.lock()
            self.pieces.forEach { try? FileManager.default.removeItem(at: $0.url) }
            self.pieces = []; self.initSegment = nil
            self.lock.unlock()
        }
    }

    private func makeWriter(at pts: CMTime) throws {
        let w = AVAssetWriter(contentType: .mpeg4Movie)
        w.outputFileTypeProfile = .mpeg4AppleHLS
        w.preferredOutputSegmentInterval = CMTime(seconds: 1, preferredTimescale: 1)
        w.initialSegmentStartTime = pts
        w.delegate = self

        let codecs = videoOut.availableVideoCodecTypesForAssetWriter(writingTo: .mp4)
        let codec: AVVideoCodecType = codecs.contains(.hevc) ? .hevc : .h264
        codecName = codec == .hevc ? "HEVC" : "H.264"
        var vs = videoOut.recommendedVideoSettings(forVideoCodecType: codec, assetWriterOutputFileType: .mp4) ?? [:]
        var props = vs[AVVideoCompressionPropertiesKey] as? [String: Any] ?? [:]
        props[AVVideoMaxKeyFrameIntervalDurationKey] = 1 // a key frame every second, so pieces can be cut anywhere
        vs[AVVideoCompressionPropertiesKey] = props
        let vi = AVAssetWriterInput(mediaType: .video, outputSettings: vs)
        vi.expectsMediaDataInRealTime = true
        vi.transform = CGAffineTransform(rotationAngle: .pi / 2) // the app is held upright: portrait video
        guard w.canAdd(vi) else { throw StartError.cannotConfigure("video encoder") }
        w.add(vi)

        var ai: AVAssetWriterInput?
        if withAudio, let asettings = audioOut.recommendedAudioSettingsForAssetWriter(writingTo: .mp4) as? [String: Any] {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: asettings)
            a.expectsMediaDataInRealTime = true
            if w.canAdd(a) { w.add(a); ai = a }
        }
        guard w.startWriting() else { throw w.error ?? StartError.cannotConfigure("writer") }
        w.startSession(atSourceTime: pts)
        writer = w; videoIn = vi; audioIn = ai; startPTS = pts
    }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard recording else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        if output === videoOut {
            if writer == nil {
                do { try makeWriter(at: pts) } catch { report("error", ["message": error.localizedDescription]); return }
            }
            guard let w = writer, w.status == .writing, let vi = videoIn else { return failIfNeeded() }
            if vi.isReadyForMoreMediaData { vi.append(sb) }
        } else if output === audioOut {
            guard let w = writer, w.status == .writing, let ai = audioIn, startPTS.isValid, pts >= startPTS else { return }
            if ai.isReadyForMoreMediaData { ai.append(sb) }
        }
    }

    private func failIfNeeded() {
        guard let w = writer, w.status == .failed else { return }
        report("error", ["message": w.error?.localizedDescription ?? "encoder failed"])
        writer = nil; videoIn = nil; audioIn = nil; startPTS = .invalid // a new writer starts with the next frame
        lock.lock(); pieces.forEach { try? FileManager.default.removeItem(at: $0.url) }; pieces = []; initSegment = nil; lock.unlock()
    }

    public func assetWriter(_ writer: AVAssetWriter, didOutputSegmentData segmentData: Data,
                            segmentType: AVAssetSegmentType, segmentReport: AVAssetSegmentReport?) {
        switch segmentType {
        case .initialization:
            lock.lock(); initSegment = segmentData; lock.unlock()
        case .separable:
            let rep = segmentReport?.trackReports.first(where: { $0.mediaType == .video }) ?? segmentReport?.trackReports.first
            let start = rep.map { CMTimeGetSeconds($0.earliestPresentationTimeStamp) } ?? 0
            let dur = rep.map { CMTimeGetSeconds($0.duration) } ?? 1
            lock.lock()
            pieceNo += 1
            let url = dir.appendingPathComponent("p\(pieceNo).m4s")
            lock.unlock()
            do { try segmentData.write(to: url) } catch { return }
            lock.lock()
            pieces.append(Piece(url: url, start: start, duration: dur.isFinite ? dur : 1))
            var total = pieces.reduce(0) { $0 + $1.duration }
            while total > maxLength, let first = pieces.first {
                total -= first.duration
                try? FileManager.default.removeItem(at: first.url)
                pieces.removeFirst()
            }
            lock.unlock()
        @unknown default:
            break
        }
    }

    // MARK: - save

    public enum SaveError: LocalizedError {
        case empty, export(String)
        public var errorDescription: String? {
            switch self {
            case .empty: return "아직 녹화된 장면이 없어요."
            case .export(let m): return "클립을 만들지 못했어요. (\(m))"
            }
        }
    }

    /// the last `seconds` as a movie file in the app's clips folder (no re-encoding)
    public func save(seconds: Double, completion: @escaping (Result<Clip, Error>) -> Void) {
        lock.lock()
        let initData = initSegment
        let all = pieces
        lock.unlock()
        guard let initData = initData, let last = all.last else { return completion(.failure(SaveError.empty)) }
        let end = last.start + last.duration
        let chosen = all.filter { $0.start + $0.duration > end - seconds - 0.01 }

        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let joined = dir.appendingPathComponent("join-\(stamp).mp4")
        do {
            FileManager.default.createFile(atPath: joined.path, contents: nil)
            let h = try FileHandle(forWritingTo: joined)
            h.write(initData)
            for p in chosen { if let d = try? Data(contentsOf: p.url) { h.write(d) } }
            try h.close()
        } catch { return completion(.failure(SaveError.export(error.localizedDescription))) }

        let asset = AVURLAsset(url: joined)
        asset.loadValuesAsynchronously(forKeys: ["tracks", "duration"]) {
            guard let vt = asset.tracks(withMediaType: .video).first else {
                try? FileManager.default.removeItem(at: joined)
                return completion(.failure(SaveError.export("no video")))
            }
            let range = vt.timeRange
            let endT = CMTimeRangeGetEnd(range)
            let want = CMTime(seconds: seconds, preferredTimescale: 600)
            let startT = CMTimeMaximum(range.start, CMTimeSubtract(endT, want))
            let out = self.clipsDir.appendingPathComponent("BetaLog-\(stamp).mov")
            guard let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
                try? FileManager.default.removeItem(at: joined)
                return completion(.failure(SaveError.export("export")))
            }
            ex.outputURL = out
            ex.outputFileType = .mov
            ex.timeRange = CMTimeRange(start: startT, end: endT)
            ex.shouldOptimizeForNetworkUse = true
            ex.exportAsynchronously {
                try? FileManager.default.removeItem(at: joined)
                if ex.status == .completed {
                    let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
                    completion(.success(Clip(url: out, seconds: CMTimeGetSeconds(CMTimeSubtract(endT, startT)), size: size)))
                } else {
                    completion(.failure(SaveError.export(ex.error?.localizedDescription ?? "status \(ex.status.rawValue)")))
                }
            }
        }
    }

    /// adds a video file to the Photos library ("add only" permission)
    public static func saveToPhotos(_ url: URL, completion: @escaping (Bool, String?) -> Void) {
        let go = {
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: url)
            }) { ok, err in completion(ok, err?.localizedDescription) }
        }
        let st = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if st == .authorized || st == .limited { return go() }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { s in
            if s == .authorized || s == .limited { go() } else { completion(false, "사진 권한이 꺼져 있어요. 설정 → 베타로그 → 사진에서 허용해 주세요.") }
        }
    }

    // MARK: - interruptions (calls, other apps, going to the background)

    private func report(_ name: String, _ data: [String: Any]) {
        DispatchQueue.main.async { self.onEvent?(name, data) }
    }
    @objc private func interrupted(_ n: Notification) {
        report("interrupted", [:])
    }
    @objc private func interruptionEnded(_ n: Notification) {
        // the recording has a gap now: start the buffer over so a saved clip never jumps
        resetBuffer()
        report("resumed", [:])
    }
    @objc private func runtimeError(_ n: Notification) {
        let err = n.userInfo?[AVCaptureSessionErrorKey] as? AVError
        report("error", ["message": err?.localizedDescription ?? "camera error"])
        sessionQueue.async { if self.recording && !self.session.isRunning { self.session.startRunning() } }
    }
    /// call when the app comes back to the front
    public func resumeIfNeeded() {
        sessionQueue.async { if self.recording && !self.session.isRunning { self.resetBuffer(); self.session.startRunning() } }
    }
}
