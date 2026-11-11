//go:build windows

package main

import (
	"errors"
	"syscall"
	"unsafe"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	pOpenFileMapping = kernel32.NewProc("OpenFileMappingW")
	pMapViewOfFile   = kernel32.NewProc("MapViewOfFile")
	pUnmapViewOfFile = kernel32.NewProc("UnmapViewOfFile")
	pCloseHandle     = kernel32.NewProc("CloseHandle")
)

const fileMapRead = 0x0004

type shm struct {
	handle uintptr
	view   uintptr
	mem    []byte
}

func openSHM() (*shm, error) {
	name, _ := syscall.UTF16PtrFromString("LMU_Data")
	h, _, err := pOpenFileMapping.Call(fileMapRead, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return nil, err
	}
	v, _, err := pMapViewOfFile.Call(h, fileMapRead, 0, 0, uintptr(MappingSize))
	if v == 0 {
		pCloseHandle.Call(h)
		return nil, err
	}
	return &shm{handle: h, view: v, mem: unsafe.Slice((*byte)(unsafe.Pointer(v)), MappingSize)}, nil
}

func (s *shm) close() {
	if s.view != 0 {
		pUnmapViewOfFile.Call(s.view)
	}
	if s.handle != 0 {
		pCloseHandle.Call(s.handle)
	}
}

// read copies the mapping; retries when the scoring clock moved during the copy.
func (s *shm) read(buf []byte) error {
	off := OffScoringInfo + ScoringInfo.o("mCurrentET")
	for i := 0; i < 5; i++ {
		before := string(s.mem[off : off+8])
		copy(buf, s.mem)
		if string(s.mem[off:off+8]) == before {
			return nil
		}
	}
	return errors.New("inkonsistente Daten")
}
