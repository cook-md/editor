import Cocoa
import SwiftUI
import Quartz

final class PreviewViewController: NSViewController, QLPreviewingController {
    private static let maxBytes = 512 * 1024 // cap for Quick Look's time budget

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 640, height: 800))
    }

    func preparePreviewOfFile(at url: URL) async throws {
        let source = try readCapped(url)
        let host: NSView
        if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            host = textFallback(source)
        } else {
            let model = RecipePreviewModel.from(
                source: source,
                fallbackTitle: url.deletingPathExtension().lastPathComponent
            )
            host = NSHostingView(rootView: RecipePreviewView(model: model))
        }
        embed(host)
    }

    private func readCapped(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = handle.readData(ofLength: Self.maxBytes)
        return String(decoding: data, as: UTF8.self)
    }

    private func textFallback(_ source: String) -> NSView {
        let scroll = NSTextView.scrollableTextView()
        if let textView = scroll.documentView as? NSTextView {
            textView.string = source
            textView.isEditable = false
            textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        }
        return scroll
    }

    private func embed(_ host: NSView) {
        host.translatesAutoresizingMaskIntoConstraints = false
        view.subviews.forEach { $0.removeFromSuperview() }
        view.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.topAnchor.constraint(equalTo: view.topAnchor),
            host.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }
}
