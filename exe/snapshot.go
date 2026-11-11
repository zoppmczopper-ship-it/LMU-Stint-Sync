package main

import (
	"encoding/binary"
	"math"
	"sort"
	"strings"
)

// Car is one vehicle's scoring row (data for every car in the session).
type Car struct {
	ID, Laps, Place, ClassPlace, Pitstops, Penalties, Control, PitState, Finish int
	Driver, Vehicle, Class                                                      string
	Best, Last, LastS1, LastS2, GapNext, GapLeader                              float64
	LapsBehindNext, LapsBehindLeader                                            int
	IsPlayer, InPits                                                            bool
}

// Tel is the player's own telemetry.
type Tel struct {
	Lap                   int
	Fuel, FuelCap         float64
	VE, Battery           float64
	Wear, TempC, PressKPa [4]float64
	TyreIMO               [4][3]float64 // innen / mitte / außen in °C
	BrakeC, CarcassC      [4]float64
	WaterC, OilC          float64
	Overheating           bool
	// Fahrdynamik (für die Setup-Tipps)
	VelX, VelZ, AccX, YawRate   float64
	Throttle, Brake, Steer      float64
	RideH                       [4]float64
	LatPatch, LongPatch, GndVel [4]float64
	ABSActive, TCActive         bool
	Set                         CarSet
	Dents                       int
	Detached, Flat              bool
	LastImpactET, LastImpactMag float64
	CompoundF, CompoundR, Model string
	GapAhead, GapBehind         float64
	PosX, PosZ                  float64 // Weltkoordinaten (m) für die Streckenkarte
	ElapsedT, LapStartT         float64 // Sessionzeit / Start der laufenden Runde (s)
}

// CarSet sind die im Auto verstellbaren Werte.
type CarSet struct {
	TC, TCMax, TCSlip, TCSlipMax, TCCut, TCCutMax, ABS, ABSMax, Map, MapMax, Mig, MigMax, ArbF, ArbFMax, ArbR, ArbRMax int
	BiasFront                                                                                                          float64
}

// Snap is one coherent read of LMU_Data.
type Snap struct {
	GameVersion                          int
	Track, PlayerName                    string
	Session, GamePhase, Yellow           int
	ET, EndET, TimeRemaining             float64
	InRealtime                           bool
	Raining, TrackTemp, AmbientTemp, Wet float64
	Cars                                 []Car
	Player                               *Car
	Tel                                  *Tel
}

type rd []byte

func (b rd) f64(o int) float64 { return math.Float64frombits(binary.LittleEndian.Uint64(b[o:])) }
func (b rd) f32(o int) float64 {
	return float64(math.Float32frombits(binary.LittleEndian.Uint32(b[o:])))
}
func (b rd) i32(o int) int { return int(int32(binary.LittleEndian.Uint32(b[o:]))) }
func (b rd) i16(o int) int { return int(int16(binary.LittleEndian.Uint16(b[o:]))) }
func (b rd) u8(o int) int  { return int(b[o]) }
func (b rd) i8(o int) int  { return int(int8(b[o])) }
func (b rd) str(o, n int) string {
	s := b[o : o+n]
	if i := strings.IndexByte(string(s), 0); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(strings.ToValidUTF8(string(s), ""))
}

func fin(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// parse decodes a full copy of the mapping.
func parse(buf []byte) *Snap {
	b := rd(buf)
	si := OffScoringInfo
	s := &Snap{
		GameVersion:   b.i32(OffGameVersion),
		Track:         b.str(si+ScoringInfo.o("mTrackName"), 64),
		Session:       b.i32(si + ScoringInfo.o("mSession")),
		ET:            b.f64(si + ScoringInfo.o("mCurrentET")),
		EndET:         b.f64(si + ScoringInfo.o("mEndET")),
		GamePhase:     b.u8(si + ScoringInfo.o("mGamePhase")),
		Yellow:        b.i8(si + ScoringInfo.o("mYellowFlagState")),
		InRealtime:    b.u8(si+ScoringInfo.o("mInRealtime")) != 0,
		PlayerName:    b.str(si+ScoringInfo.o("mPlayerName"), 32),
		Raining:       fin(b.f64(si + ScoringInfo.o("mRaining"))),
		TrackTemp:     fin(b.f64(si + ScoringInfo.o("mTrackTemp"))),
		AmbientTemp:   fin(b.f64(si + ScoringInfo.o("mAmbientTemp"))),
		Wet:           fin(b.f64(si + ScoringInfo.o("mAvgPathWetness"))),
		TimeRemaining: fin(b.f32(si + ScoringInfo.o("mSessionTimeRemaining"))),
	}
	n := b.i32(si + ScoringInfo.o("mNumVehicles"))
	if n < 0 || n > MaxVehicles {
		n = 0
	}
	for i := 0; i < n; i++ {
		o := OffVehScoring + i*VehScoring.size()
		v := func(name string) int { return o + VehScoring.o(name) }
		c := Car{
			ID: b.i32(v("mID")), Driver: b.str(v("mDriverName"), 32), Vehicle: b.str(v("mVehicleName"), 64),
			Laps: b.i16(v("mTotalLaps")), Finish: b.i8(v("mFinishStatus")),
			Best: fin(b.f64(v("mBestLapTime"))), Last: fin(b.f64(v("mLastLapTime"))),
			LastS1: fin(b.f64(v("mLastSector1"))), LastS2: fin(b.f64(v("mLastSector2"))),
			Pitstops: b.i16(v("mNumPitstops")), Penalties: b.i16(v("mNumPenalties")),
			IsPlayer: b.u8(v("mIsPlayer")) != 0, Control: b.i8(v("mControl")), InPits: b.u8(v("mInPits")) != 0,
			Place: b.u8(v("mPlace")), Class: b.str(v("mVehicleClass"), 32),
			GapNext: fin(b.f64(v("mTimeBehindNext"))), LapsBehindNext: b.i32(v("mLapsBehindNext")),
			GapLeader: fin(b.f64(v("mTimeBehindLeader"))), LapsBehindLeader: b.i32(v("mLapsBehindLeader")),
			PitState: b.u8(v("mPitState")),
		}
		s.Cars = append(s.Cars, c)
	}
	// class positions
	byClass := map[string][]int{}
	for i, c := range s.Cars {
		byClass[c.Class] = append(byClass[c.Class], i)
	}
	for _, idx := range byClass {
		sort.Slice(idx, func(a, b int) bool { return s.Cars[idx[a]].Place < s.Cars[idx[b]].Place })
		for p, i := range idx {
			s.Cars[i].ClassPlace = p + 1
		}
	}
	for i := range s.Cars {
		if s.Cars[i].IsPlayer {
			s.Player = &s.Cars[i]
		}
	}
	if b.u8(OffPlayerHasVehicle) != 0 {
		idx := b.u8(OffPlayerIdx)
		if idx < MaxVehicles {
			o := OffTelemInfo + idx*VehTelem.size()
			v := func(name string) int { return o + VehTelem.o(name) }
			t := &Tel{
				Lap: b.i32(v("mLapNumber")), Fuel: fin(b.f64(v("mFuel"))), FuelCap: fin(b.f64(v("mFuelCapacity"))),
				VE: fin(b.f32(v("mVirtualEnergy"))), Battery: fin(b.f64(v("mBatteryChargeFraction"))),
				LastImpactET: fin(b.f64(v("mLastImpactET"))), LastImpactMag: fin(b.f64(v("mLastImpactMagnitude"))),
				CompoundF: b.str(v("mFrontTireCompoundName"), 18), CompoundR: b.str(v("mRearTireCompoundName"), 18),
				Model: b.str(v("mVehicleModel"), 30), Detached: b.u8(v("mDetached")) != 0,
				WaterC: fin(b.f64(v("mEngineWaterTemp"))), OilC: fin(b.f64(v("mEngineOilTemp"))),
				Overheating: b.u8(v("mOverheating")) != 0,
				VelX:        fin(b.f64(v("mLocalVel"))), VelZ: fin(b.f64(v("mLocalVel") + 16)),
				AccX: fin(b.f64(v("mLocalAccel"))), YawRate: fin(b.f64(v("mLocalRot") + 8)),
				Throttle: fin(b.f64(v("mUnfilteredThrottle"))), Brake: fin(b.f64(v("mUnfilteredBrake"))),
				Steer:     fin(b.f64(v("mUnfilteredSteering"))),
				ABSActive: b.u8(v("mABSActive")) != 0, TCActive: b.u8(v("mTCActive")) != 0,
				Set: CarSet{TC: b.u8(v("mTC")), TCMax: b.u8(v("mTCMax")), TCSlip: b.u8(v("mTCSlip")), TCSlipMax: b.u8(v("mTCSlipMax")),
					TCCut: b.u8(v("mTCCut")), TCCutMax: b.u8(v("mTCCutMax")), ABS: b.u8(v("mABS")), ABSMax: b.u8(v("mABSMax")),
					Map: b.u8(v("mMotorMap")), MapMax: b.u8(v("mMotorMapMax")), Mig: b.u8(v("mMigration")), MigMax: b.u8(v("mMigrationMax")),
					ArbF: b.u8(v("mFrontAntiSway")), ArbFMax: b.u8(v("mFrontAntiSwayMax")), ArbR: b.u8(v("mRearAntiSway")), ArbRMax: b.u8(v("mRearAntiSwayMax")),
					BiasFront: fin((1 - b.f64(v("mRearBrakeBias"))) * 100)},
				GapAhead: fin(b.f32(v("mTimeGapPlaceAhead"))), GapBehind: fin(b.f32(v("mTimeGapPlaceBehind"))),
				PosX: fin(b.f64(v("mPos"))), PosZ: fin(b.f64(v("mPos") + 16)),
				ElapsedT: fin(b.f64(v("mElapsedTime"))), LapStartT: fin(b.f64(v("mLapStartET"))),
			}
			for k := 0; k < 8; k++ {
				t.Dents += b.u8(v("mDentSeverity") + k)
			}
			for w := 0; w < 4; w++ {
				wo := v("mWheels") + w*Wheel.size()
				t.Wear[w] = fin(b.f64(wo + Wheel.o("mWear")))
				t.TempC[w] = fin(b.f64(wo+Wheel.o("mTemperature")+8)) - 273.15
				t.PressKPa[w] = fin(b.f64(wo + Wheel.o("mPressure")))
				t.BrakeC[w] = fin(b.f64(wo + Wheel.o("mBrakeTemp")))
				t.RideH[w] = fin(b.f64(wo + Wheel.o("mRideHeight")))
				t.LatPatch[w] = fin(b.f64(wo + Wheel.o("mLateralPatchVel")))
				t.LongPatch[w] = fin(b.f64(wo + Wheel.o("mLongitudinalPatchVel")))
				t.GndVel[w] = fin(b.f64(wo + Wheel.o("mLongitudinalGroundVel")))
				t.CarcassC[w] = fin(b.f64(wo+Wheel.o("mTireCarcassTemperature"))) - 273.15
				var lcr [3]float64
				for k := 0; k < 3; k++ {
					lcr[k] = fin(b.f64(wo+Wheel.o("mTemperature")+8*k)) - 273.15
				}
				if w == 0 || w == 2 { // linke Räder: außen = links
					t.TyreIMO[w] = [3]float64{lcr[2], lcr[1], lcr[0]}
				} else { // rechte Räder: innen = links
					t.TyreIMO[w] = [3]float64{lcr[0], lcr[1], lcr[2]}
				}
				if b.u8(wo+Wheel.o("mFlat")) != 0 {
					t.Flat = true
				}
			}
			s.Tel = t
		}
	}
	return s
}

func sessionName(n int) string {
	switch {
	case n == 0:
		return "Testtag"
	case n >= 1 && n <= 4:
		return "Training"
	case n >= 5 && n <= 8:
		return "Qualifying"
	case n == 9:
		return "Warmup"
	case n >= 10 && n <= 13:
		return "Rennen"
	}
	return "?"
}
