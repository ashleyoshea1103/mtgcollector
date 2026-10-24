package main

import (
	"fmt"
	"io/fs"
	"syscall"
)

// sysStamp is a file's inode and change time. Nothing can set a file's change time, so an
// edit shows even when the modification time is put back.
func sysStamp(_ string, info fs.FileInfo) string {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return fmt.Sprintf("%d %d.%09d", st.Ino, st.Ctimespec.Sec, st.Ctimespec.Nsec)
	}
	return ""
}
