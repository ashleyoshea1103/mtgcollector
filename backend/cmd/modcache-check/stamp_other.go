//go:build !linux && !darwin

package main

import "io/fs"

// sysStamp adds nothing here: on Windows, nothing records when a file's metadata last changed.
func sysStamp(fs.FileInfo) string { return "" }
