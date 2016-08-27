

L.TileLayer.NoGap = L.TileLayer.extend({

	options: {
		crossOrigin: true
	},
	
	onAdd: function(map) {
		// Create a <canvas> in addition to the tile wrapper
		L.TileLayer.prototype.onAdd.call(this, map);

// 		this._canvas = L.DomUtil.create('canvas');
// 		this.getPane().appendChild(this._canvas)
// 		this._container.appendChild(this._canvas);
// 		this._ctx = this._canvas.getContext(2d);
		
// 		map.on('resize', this._updateCanvasSize, this);
		
	},

	
	_updateCanvasSize: function() {
		
	},
	

/// TODO: _resetGrid
	
	
/// TODO: _update: check the tileRange and update the canvasRange of the canvas of the current level


/// TODO: _updateLevels: Check if there is a canvas in the current level, create it if not.
	
	
	_updateLevels: function() {
		
		var zoom = this._tileZoom,
		    maxZoom = this.options.maxZoom;

		if (zoom === undefined) { return undefined; }

		// Reset the z-index of the canvas, or remove the canvas
		// This is in addition to this._levels[z].el, which is
		// the container for individual tiles.
		for (var z in this._levels) {
			if (this._levels[z].el.children.length || z === zoom) {
				this._levels[z].canvas.style.zIndex = maxZoom - Math.abs(zoom - z);
			} else {
				L.DomUtil.remove(this._levels[z].canvas);
				// delete this._levels[z]; // Will be done by parent.
			}
		}
		
		L.TileLayer.prototype._updateLevels.call(this);
		
		// Create a canvas for the current level if it doesn't exist.
		var level = this._levels[zoom];
		if (!level.canvas) {
			level.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', this._container);
			level.ctx = level.canvas.getContext('2d');
			
			this._resetCanvasSize(level);


			canvasSize = level.canvasPxRange.max.subtract(level.canvasPxRange.min);

			level.canvas.width  = canvasSize.x;
			level.canvas.height = canvasSize.y;

		}
	},
	
	_resetCanvasSize: function(level) {
		var pixelBounds = this._getTiledPixelBounds(map.getCenter()),
			tileRange = this._pxBoundsToTileRange(pixelBounds),
			tileSize = this.getTileSize(),
			pixelRange = L.bounds(tileRange.min.scaleBy(tileSize),
			tileRange.max.add([1,1]).scaleBy(tileSize)),
			mustRepositionCanvas = false;
			
		// Translate the canvas contents if it's moved around
		if (level.canvasRange) {
			
			var offset = level.canvasRange.min.subtract(tileRange.min).scaleBy(this.getTileSize());
			var w = level.canvas.width;
			var h = level.canvas.height;
			
			console.log('Repositioning canvas contents by ', offset);
			
			level.ctx.drawImage(level.canvas, offset.x, offset.y);
			
			// Top strip
			if (offset.y > 0) level.ctx.clearRect(0, 0, w, offset.y);
			
			// Bottom strip
			if (offset.y < 0) level.ctx.clearRect(0, h + offset.y, w, -offset.y);
			
			// Left strip
			if (offset.x > 0) level.ctx.clearRect(0, 0, offset.x, h);
			
			// Right strip
			if (offset.x < 0) level.ctx.clearRect(w + offset.x, 0, -offset.x, h);
			
			
			mustRepositionCanvas = true;	// Wait until new props are set
			
			/// TODO: Loop through the level's tiles, mark tiles outside the canvas as removed.
			
		}
			
		level.canvasRange = tileRange;
		level.canvasPxRange = pixelRange;
		level.canvasOrigin = pixelRange.min;
		
		console.log('Canvas tile range: ', tileRange.min, tileRange.max );
		console.log('Canvas pixel range: ', pixelRange.min, pixelRange.max );
		console.log('Level origin: ', level.origin );

		if (mustRepositionCanvas) {
			this._setCanvasZoomTransform(level, this._map.getCenter(), this._map.getZoom());
		}
		
		/// TODO: What to do when the canvas size has to change due a map "resize" event or so???
// 		if ()
	},
	

	/// set transform/position of canvas, in addition to the transform/position of the individual tile container
	_setZoomTransform: function(level, center, zoom) {
		
		L.TileLayer.prototype._setZoomTransform.call(this, level, center, zoom);
		
		if (!level.canvasOrigin) return;	/// FIXME: Move around the _updateLevels code so canvasOrigin exists by the time this is called.
		
		this._setCanvasZoomTransform(level, center, zoom);
	},
	
	
	// This will get called twice:
	// * From _setZoomTransform
	// * When the canvas has shifted due to a pan
	_setCanvasZoomTransform: function(level, center, zoom){
		var scale = this._map.getZoomScale(zoom, level.zoom),
		    translate = level.canvasOrigin.multiplyBy(scale)
		        .subtract(this._map._getNewPixelOrigin(center, zoom)).round();

		if (L.Browser.any3d) {
			L.DomUtil.setTransform(level.canvas, translate, scale);
		} else {
			L.DomUtil.setPosition(level.canvas, translate);
		}
	},
	
	// Rewrite _updateOpacity to make a func call to dump the faded-in tile into the canvas
	_updateOpacity: function () {
		if (!this._map) { return; }

		// IE doesn't inherit filter opacity properly, so we're forced to set it on tiles
		if (L.Browser.ielt9) { return; }

		L.DomUtil.setOpacity(this._container, this.options.opacity);

		var now = +new Date(),
		    nextFrame = false,
		    willPrune = false;

		for (var key in this._tiles) {
			var tile = this._tiles[key];
			if (!tile.current || !tile.loaded) { continue; }

			var fade = Math.min(1, (now - tile.loaded) / 200);

			L.DomUtil.setOpacity(tile.el, fade);
			if (fade < 1) {
				nextFrame = true;
			} else {
				if (tile.active) { 
					willPrune = true;
				} else {
					this._dumpTileToCanvas(tile);	////// !!!!!!
					/// TODO: Do this only if canvas is being used
				}
				tile.active = true;
			}
		}

		if (willPrune && !this._noPrune) { this._pruneTiles(); }

		if (nextFrame) {
			L.Util.cancelAnimFrame(this._fadeFrame);
			this._fadeFrame = L.Util.requestAnimFrame(this._updateOpacity, this);
		}
	},
	
	
	_dumpTileToCanvas: function(tile){
		
		var level = this._levels[tile.coords.z];
		
		if (!level.canvasRange.contains(tile.coords)) {
			/// FIXME: Instead of resetting the canvas size,
			/// calculate the canvas new offset based on
			/// how out the tile is from the canvas range.
			this._resetCanvasSize(level);
		}
		
		var offset = L.point(tile.coords.x, tile.coords.y).subtract(level.canvasRange.min).scaleBy(this.getTileSize());
		
// 		console.log('Should dump tile to canvas:', tile);
// 		console.log('Should dump from tile coords:', tile.coords);
		console.log('Should dump to canvas px coords:', tile.coords, offset);
		
		level.ctx.drawImage(tile.el, offset.x, offset.y);
		
		L.DomUtil.remove(tile.el);
		
	},
	
	
	
});





