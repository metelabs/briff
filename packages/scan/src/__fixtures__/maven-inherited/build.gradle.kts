configurations.all { resolutionStrategy { force("org.acme:unused:1.2.3") } }
dependencies { implementation("org.acme:used:1.2.3") }
