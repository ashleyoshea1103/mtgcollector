package main

import (
	"io/fs"
	"strconv"
	"syscall"
	"unsafe"
)

// sysStamp is the file's update sequence number in the NTFS change journal: every write to the
// file, and every change to its times or attributes, gives it a new and higher one, which no
// program can set back. Without a journal (another file system, say) it's empty, and only the
// size, modification time and mode are left.
func sysStamp(path string, _ fs.FileInfo) string {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	const fileReadAttributes, openReparsePoint = 0x80, 0x00200000
	h, err := syscall.CreateFile(p, fileReadAttributes, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil, syscall.OPEN_EXISTING, syscall.FILE_FLAG_BACKUP_SEMANTICS|openReparsePoint, 0)
	if err != nil {
		return ""
	}
	defer syscall.CloseHandle(h)
	// A USN_RECORD_V2, whose Usn field is its fourth 8-byte word; the buffer must be aligned.
	const fsctlReadFileUSNData = 0x000900eb
	var record [128]uint64
	var n uint32
	if err := syscall.DeviceIoControl(h, fsctlReadFileUSNData, nil, 0,
		(*byte)(unsafe.Pointer(&record[0])), uint32(len(record)*8), &n, nil); err != nil || n < 32 {
		return ""
	}
	return strconv.FormatUint(record[3], 10)
}
