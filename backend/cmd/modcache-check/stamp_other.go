//go:build !linux && !darwin && !windows

package main

import "io/fs"

// sysStamp adds nothing here.
func sysStamp(string, fs.FileInfo) string { return "" }
