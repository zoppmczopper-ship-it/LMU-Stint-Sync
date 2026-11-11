//go:build !windows

package main

import "errors"

type shm struct{}

func openSHM() (*shm, error)       { return nil, errors.New("LMU_Data gibt es nur unter Windows") }
func (s *shm) close()              {}
func (s *shm) read(_ []byte) error { return errors.New("nicht verfügbar") }
