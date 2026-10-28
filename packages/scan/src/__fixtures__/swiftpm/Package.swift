// swift-tools-version:5.9
import PackageDescription
let package = Package(
    name: "AcmeServer",
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.50.0")
    ],
    targets: [.executableTarget(name: "AcmeServer", dependencies: [.product(name: "Vapor", package: "vapor")])]
)
