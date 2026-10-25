// Acme job runner.
module github.com/acme/jobs

go 1.23.0

toolchain go1.23.4

require (
	github.com/acme/kit/v2 v2.4.1
	github.com/acme/queue v1.9.0
	golang.org/x/net v0.30.0
	gopkg.in/acme/yaml.v3 v3.0.1 // indirect
)

require (
	github.com/acme/retry v0.0.0-20240611120000-0123456789ab // indirect
	github.com/Acme/Legacy v1.2.0+incompatible // indirect
	github.com/acme/forked v1.0.0
	github.com/acme/local v0.1.0
	golang.org/x/text v0.19.0 // indirect
)

require github.com/acme/single v1.0.0

replace github.com/acme/forked => github.com/acme-mirror/forked v1.0.3

replace github.com/acme/local => ../local

replace golang.org/x/text v0.18.0 => golang.org/x/text v0.18.1

exclude github.com/acme/queue v1.8.0

retract v0.9.0 // published by mistake
