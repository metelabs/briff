dependencies {
    implementation("org.apache.logging.log4j:log4j-core")
    constraints {
        implementation("org.acme:unused:1.2.3") {
            because("a reason with { braces }")
        }
    }
}
