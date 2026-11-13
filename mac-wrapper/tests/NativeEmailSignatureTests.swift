import Foundation
import CryptoKit
import Darwin
@main struct NativeEmailSignatureTests {
    static func main() throws {
        var checks: [String] = []
        func check(_ value: @autoclosure () -> Bool, _ name: String) { guard value() else { fatalError(name) }; checks.append(name) }
        let root = URL(fileURLWithPath: "/private/tmp/axoncros-signature-test-" + UUID().uuidString)
        let fm = FileManager.default; try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]); defer { try? fm.removeItem(at: root) }
        func put(_ name: String, _ data: Data) throws { let url = root.appendingPathComponent(name); try data.write(to: url); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path) }
        let html = "<p>Approved synthetic signature</p>" + (0..<12).map { "<img src=\"cid:asset\($0)\">" }.joined()
        let plain = "Approved synthetic signature", gif = Data("GIF89aSYNTHETIC-BYTES-PRESERVED".utf8)
        var assets: [[String: Any]] = []
        for i in 0..<12 { let name = "asset\(i).gif"; try put(name, gif); assets.append(["file":name,"cid":"asset\(i)","mimeType":"image/gif","sha256":NativeEmailSignature.digest(gif)]) }
        try put("signature.html",Data(html.utf8)); try put("signature.txt",Data(plain.utf8))
        var manifest: [String: Any] = ["version":1,"senderEmail":"synthetic@example.invalid","htmlFile":"signature.html","textFile":"signature.txt","htmlSHA256":NativeEmailSignature.digest(Data(html.utf8)),"textSHA256":NativeEmailSignature.digest(Data(plain.utf8)),"assets":assets]
        func save() throws { try put("manifest.json",JSONSerialization.data(withJSONObject:manifest,options:.sortedKeys)) }
        try save()
        let package = try NativeEmailSignature.load(directory:root,senderEmail:"SYNTHETIC@example.invalid")!
        check(package.assets.count == 12 && package.html == html && package.text == plain, "Validated private package preserves exact original HTML plaintext and 12 assets")
        check(try! NativeEmailSignature.load(directory:root,senderEmail:"other@example.invalid") == nil, "Other sender retains unsigned behavior")
        check(try! NativeEmailSignature.load(directory:root.appendingPathComponent("absent"),senderEmail:"synthetic@example.invalid") == nil, "No configured package retains unsigned behavior")
        let body = "Hello,\n\n\nKeep <script>literal</script> & text unchanged."
        let mime = NativeEmailSignature.mime(body:body,signature:package)
        check(mime.components(separatedBy:"Content-ID:").count-1 == 12 && mime.components(separatedBy:"Content-Disposition: inline").count-1 == 12, "MIME embeds exactly12 inline CID parts")
        check(mime.contains("multipart/related") && mime.contains("multipart/alternative") && mime.contains("image/gif"), "MIME has alternative text and HTML plus related GIFs")
        check(mime.contains(NativeEmailSignature.base64(Data((body+"\n\n\n"+plain).utf8))), "Plaintext body is byte-preserved before approved signature")
        let expectedHTML="<div style=\"white-space:pre-wrap;\">"+NativeEmailSignature.escapedHTML(body)+"</div>\n<br><br>\n"+html
        check(mime.contains(NativeEmailSignature.base64(Data(expectedHTML.utf8))), "HTML escapes model body and includes unchanged canonical signature")
        check(mime.components(separatedBy:NativeEmailSignature.base64(gif)).count-1 == 12, "Inline GIF data preserved without image conversion")
        let unsigned=NativeEmailSignature.mime(body:body,signature:nil)
        check(unsigned.contains(NativeEmailSignature.base64(Data(body.utf8))) && !unsigned.contains("multipart"), "Unsigned MIME remains plaintext only")
        try fm.removeItem(at:root.appendingPathComponent("asset0.gif"))
        check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil, "Missing required asset blocks signature load")
        try put("asset0.gif",Data("GIF89aCHANGED".utf8))
        check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil, "Changed asset hash blocks signature load")
        try fm.removeItem(at:root.appendingPathComponent("asset0.gif"));try fm.createSymbolicLink(atPath:root.appendingPathComponent("asset0.gif").path,withDestinationPath:root.appendingPathComponent("asset1.gif").path)
        check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil, "Symlink asset cannot read another target")
        try fm.removeItem(at:root.appendingPathComponent("asset0.gif"));try put("asset0.gif",gif)
        let original=manifest
        for (label, replacement) in [("remote image", html.replacingOccurrences(of:"cid:asset0",with:"https://example.invalid/a.gif")),("unquoted remote image",html+"<img src=https://example.invalid/a.gif>"),("active HTML",html+"<script>alert(1)</script>")] {
            try put("signature.html",Data(replacement.utf8));manifest["htmlSHA256"]=NativeEmailSignature.digest(Data(replacement.utf8));try save()
            check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil,"Rejects \(label) even with changed local hash")
        }
        manifest=original;try put("signature.html",Data(html.utf8));try save()
        let oversized=Data(repeating:0,count:NativeEmailSignature.maxAssetBytes+1);try put("asset0.gif",oversized)
        check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil,"Oversized asset rejected before MIME construction")
        try put("asset0.gif",gif)
        var changed=assets;changed[0]["file"]="../outside.gif";manifest["assets"]=changed;try save()
        check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil,"Manifest cannot select arbitrary filesystem paths")
        manifest=original;try save();try fm.setAttributes([.posixPermissions:0o666],ofItemAtPath:root.appendingPathComponent("signature.html").path)
        check((try? NativeEmailSignature.load(directory:root,senderEmail:"synthetic@example.invalid")) == nil,"Group or world writable signature data rejected")
        print(String(data:try JSONSerialization.data(withJSONObject:["passed":true,"checks":checks,"checkCount":checks.count,"realEmails":0,"privateAssetsCopied":false],options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
    }
}
