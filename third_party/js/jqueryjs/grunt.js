/**
 * Resources
 *
 * https://gist.github.com/2489540
 *
 */

/*global config:true, task:true*/
module.exports = function( grunt ) {

	// readOptionalJSON
	// by Ben Alman
	// https://gist.github.com/2876125
	function readOptionalJSON( filepath ) {
		var data = {};
		try {
			data = grunt.file.readJSON(filepath);
			grunt.log.write( "Reading data from " + filepath + "..." ).ok();
		} catch(e) {}
		return data;
	}

	var task = grunt.task;
	var file = grunt.file;
	var utils = grunt.utils;
	var log = grunt.log;
	var verbose = grunt.verbose;
	var fail = grunt.fail;
	var option = grunt.option;
	var config = grunt.config;
	var template = grunt.template;
	var distpaths = [
		"dist/jquery.js",
		"dist/jquery.min.js"
	];

	grunt.initConfig({
		pkg: "<json:package.json>",
		dst: readOptionalJSON("dist/.destination.json"),
		meta: {
			banner: "/*! jQuery v@<%= pkg.version %> jquery.com | jquery.org/license */"
		},
		compare_size: {
			files: distpaths
		},
		selector: {
			"src/selector.js": [
				"src/sizzle-jquery.js",
				"src/sizzle/sizzle.js"
			]
		},
		build: {
			"dist/jquery.js": [
				"src/intro.js",
				"src/core.js",
				"src/callbacks.js",
				"src/deferred.js",
				"src/support.js",
				"src/data.js",
				"src/queue.js",
				"src/attributes.js",
				"src/event.js",
				"src/selector.js",
				"src/traversing.js",
				"src/manipulation.js",
				"src/css.js",
				"src/ajax.js",
				"src/ajax/jsonp.js",
				"src/ajax/script.js",
				"src/ajax/xhr.js",
				{ flag: "effects", src: "src/effects.js" },
				{ flag: "offset", src: "src/offset.js" },
				{ flag: "dimensions", src: "src/dimensions.js" },
				"src/exports.js",
				"src/outro.js"
			]
		},
		min: {
			"dist/jquery.min.js": [ "<banner>", "dist/jquery.js" ]
		},
		lint: {
			files: [ "grunt.js", "dist/jquery.js" ]
		},
		qunit: {
			files: "test/index.html"
		},
		watch: {
			files: [ "<config:lint.files>", "src/**/*.js" ],
			tasks: "dev"
		},
		jshint: {
			options: {
				evil: true,
				browser: true,
				wsh: true,
				eqnull: true,
				expr: true,
				curly: true,
				trailing: true,
				undef: true,
				smarttabs: true,
				predef: [
					"define",
					"DOMParser",
					"__dirname"
				],
				maxerr: 100
			},
			globals: {
				jQuery: true,
				global: true,
				module: true,
				exports: true,
				require: true,
				file: true,
				log: true,
				console: true
			}
		},
		uglify: {}
	});

	// Default grunt.
	grunt.registerTask( "default", "submodules selector build:*:* dist:* lint min compare_size" );

	// Short list as a high frequency watch task
	grunt.registerTask( "dev", "selector build:*:* lint" );

	// Load the "compare_size" task from NPM packages
	grunt.loadNpmTasks("grunt-compare-size");

	grunt.registerTask( "testswarm", function( commit, configFile ) {
		var testswarm = require( "testswarm" ),
			testUrls = [],
			config = grunt.file.readJSON( configFile ).jquery;
		var tests = "ajax attributes callbacks core css data deferred dimensions effects event manipulation offset queue selector support traversing".split( " " );
		tests.forEach(function( test ) {
			testUrls.push( config.testUrl + commit + "/test/index.html?filter=" + test );
		});
		testswarm({
			url: config.swarmUrl,
			pollInterval: 10000,
			timeout: 1000 * 60 * 30,
			done: this.async()
		}, {
			authUsername: config.authUsername,
			authToken: config.authToken,
			jobName: 'jQuery commit #<a href="https://github.com/jquery/jquery/commit/' + commit + '">' + commit.substr( 0, 10 ) + '</a>',
			runMax: 4,
			"runNames[]": tests,
			"runUrls[]": testUrls,
			"browserSets[]": ["popular"]
		});
	});

	// Build src/selector.js
	grunt.registerMultiTask( "selector", "Build src/selector.js", function() {

		var name = this.file.dest,
				files = this.file.src,
				sizzle = {
					api: file.read( files[0] ),
					src: file.read( files[1] )
				},
				compiled;

		// sizzle-jquery.js -> sizzle after "EXPOSE", replace window.Sizzle
		compiled = sizzle.src.replace( "window.Sizzle = Sizzle;", sizzle.api );
		verbose.write("Injected sizzle-jquery.js into sizzle.js");

		// Write concatenated source to file
		file.write( name, compiled );

		// Fail task if errors were logged.
		if ( this.errorCount ) {
			return false;
		}

		// Otherwise, print a success message.
		log.writeln( "File '" + name + "' created." );
	});


	// Special concat/build task to handle various jQuery build requirements
	grunt.registerMultiTask(
		"build",
		"Concatenate source (include/exclude modules with +/- flags), embed date/version",
		function() {
			// Concat specified files.
			var compiled = "",
					modules = this.flags,
					optIn = !modules["*"],
					name = this.file.dest;

			this.file.src.forEach(function( filepath ) {
				// Include optional modules per build flags; exclusion trumps inclusion
				var flag = filepath.flag;
				if ( flag ) {
					if ( modules[ "-" + flag ] ||
						optIn && !modules[ flag ] && !modules[ "+" + flag ] ) {

						log.writeln( "Excluding " + filepath.flag + ": '" + filepath.src + "'." );
						return;
					}
					log.writeln( "Including " + filepath.flag + ": '" + filepath.src + "'." );
					filepath = filepath.src;
				}

				// Unwrap redundant IIFEs
				compiled += file.read( filepath );
				//.replace( /^\(function\( jQuery \) \{|\}\)\( jQuery \);\s*$/g, "" );
			});

			// Embed Date
			// Embed Version
			compiled = compiled.replace( "@DATE", new Date() )
				.replace( "@VERSION", config("pkg.version") );

			// Write concatenated source to file
			file.write( name, compiled );

			// Fail task if errors were logged.
			if ( this.errorCount ) {
				return false;
			}

			// Otherwise, print a success message.
			log.writeln( "File '" + name + "' created." );
		});

	grunt.registerTask( "submodules", function() {
		var done = this.async();

		grunt.verbose.write( "Updating submodules..." );

		// TODO: migrate remaining `make` to grunt tasks
		//
		grunt.utils.spawn({
			cmd: "make"
		}, function( err, result ) {
			if ( err ) {
				grunt.verbose.error();
				done( err );
				return;
			}

			grunt.log.writeln( result );

			done();
		});
	});

	// Allow custom dist file locations
	grunt.registerTask( "dist", function() {
		var flags, paths, stored;

		// Check for stored destination paths
		// ( set in dist/.destination.json )
		stored = Object.keys( config("dst") );

		// Allow command line input as well
		flags = Object.keys( this.flags );

		// Combine all output target paths
		paths = [].concat( stored, flags ).filter(function( path ) {
			return path !== "*";
		});


		// Proceed only if there are actual
		// paths to write to
		if ( paths.length ) {

			// 'distpaths' is declared at the top of the
			// module.exports function scope. It is an array
			// of default files that jQuery creates
			distpaths.forEach(function( filename ) {
				paths.forEach(function( path ) {
					var created;

					if ( !/\/$/.test( path ) ) {
						path += "/";
					}

					created = path + filename.replace( "dist/", "" );

					if ( !/^\//.test( path ) ) {
						log.error( "File '" + created + "' was NOT created." );
						return;
					}

					file.write( created, file.read(filename) );

					log.writeln( "File '" + created + "' created." );
				});
			});
		}
	});
};
