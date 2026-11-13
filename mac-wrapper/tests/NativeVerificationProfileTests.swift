import Foundation
import Darwin

@main
struct NativeVerificationProfileTests {
    static func main() throws {
        if CommandLine.arguments.count == 2 {
            guard let bundle = Bundle(path: CommandLine.arguments[1]),
                  let profile = try NativeVerificationProfile.load(bundleID: bundle.bundleIdentifier, info: bundle.infoDictionary ?? [:]) else { fatalError("Verification bundle rejected") }
            print("PASS: packaged verification profile validates on loopback port \(profile.port); no launch, token output, permission or primary config access.")
            return
        }
        let fm = FileManager.default
        let temporaryRealPath = realpath(fm.temporaryDirectory.path, nil)!
        defer { free(temporaryRealPath) }
        precondition(NativeVerificationProfile.allowedParent == URL(fileURLWithPath: String(cString: temporaryRealPath), isDirectory: true).appendingPathComponent("axoncros-native-verification", isDirectory: true))
        let parent = URL(fileURLWithPath: String(cString: temporaryRealPath), isDirectory: true).appendingPathComponent("axon-verification-profile-test-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: parent, withIntermediateDirectories: false, attributes: [.posixPermissions:0o700])
        defer { try? fm.removeItem(at: parent) }
        let uuid = UUID().uuidString.lowercased()
        let root = parent.appendingPathComponent("native-profile-\(uuid)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions:0o700])
        let marker = root.appendingPathComponent(".axoncros-verification.json")
        let valid: [String:Any] = ["purpose":"AxonCROS isolated native verification","port":18885,"profileId":uuid,"instanceId":"axoncros-native-\(uuid)","launchToken":String(repeating:"a",count:64)]
        func write(_ body:[String:Any]) throws {
            try JSONSerialization.data(withJSONObject: body).write(to:marker)
            try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:marker.path)
        }
        let info:[String:Any] = ["AXONCROSVerificationRoot":root.path,"AXONCROSVerificationPort":18885]
        func load(_ details:[String:Any]?=nil, bundle:String=NativeVerificationProfile.bundleIdentifier) throws -> NativeVerificationProfile? {
            try NativeVerificationProfile.load(bundleID:bundle,info:details ?? info,parent:parent)
        }
        func reject(_ label:String,_ action:()throws->Void) { do { try action(); fatalError("Accepted invalid profile: \(label)") } catch {} }
        try write(valid)
        let accepted = try load()!
        precondition(accepted.port == 18885 && accepted.storage.path.hasPrefix(root.path+"/") && accepted.keychainService.hasSuffix(uuid))
        precondition(accepted.launchBundledRuntime == false)
        var bundled = valid; bundled["launchBundledRuntime"] = true; try write(bundled)
        let bundledProfile = try load()!
        precondition(bundledProfile.launchBundledRuntime)
        bundled["launchBundledRuntime"] = "true"; try write(bundled)
        reject("invalid bundled runtime flag") { _ = try load() }
        try write(valid)
        let ordinary = try NativeVerificationProfile.load(bundleID:"local.bot-hq.desktop",info:[:],parent:parent)
        precondition(ordinary == nil)
        reject("primary bundle with locator") { _ = try load(bundle:"local.bot-hq.desktop") }
        reject("missing marker locator") { _ = try load([:]) }
        reject("outside allowed parent") { _ = try NativeVerificationProfile.load(bundleID:NativeVerificationProfile.bundleIdentifier,info:info,parent:parent.appendingPathComponent("other")) }
        for (key,value) in [("port",18886 as Any),("profileId",UUID().uuidString as Any),("instanceId","different" as Any),("launchToken","invalid" as Any),("purpose","wrong" as Any)] {
            var invalid=valid; invalid[key]=value; try write(invalid)
            reject(key) { _ = try load() }
        }
        try write(valid)
        try fm.setAttributes([.posixPermissions:0o644],ofItemAtPath:marker.path)
        reject("public marker") { _ = try load() }
        try write(valid)
        try fm.setAttributes([.posixPermissions:0o755],ofItemAtPath:root.path)
        reject("public root") { _ = try load() }
        try fm.setAttributes([.posixPermissions:0o700],ofItemAtPath:root.path)
        let storage=root.appendingPathComponent("native-store")
        try fm.createSymbolicLink(at:storage,withDestinationURL:parent)
        reject("storage symlink") { _ = try load() }
        try fm.removeItem(at:storage)
        let original=root.appendingPathComponent("marker-original.json")
        try fm.moveItem(at:marker,to:original)
        try fm.createSymbolicLink(at:marker,withDestinationURL:original)
        reject("marker symlink") { _ = try load() }
        print("PASS: private owned profile accepted; bundle/parent/UUID/port/instance/token/purpose/mode/symlink failures rejected. No application or primary config accessed.")
    }
}
