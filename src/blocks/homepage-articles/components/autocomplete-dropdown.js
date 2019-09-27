/**
 * External dependencies
 */
import { throttle } from 'lodash';
import classnames from 'classnames';
import scrollIntoView from 'dom-scroll-into-view';

/**
 * WordPress dependencies
 */
import { __, sprintf, _n } from '@wordpress/i18n';
import { Component, createRef } from '@wordpress/element';
import { UP, DOWN, ENTER, TAB } from '@wordpress/keycodes';
import { Spinner, withSpokenMessages, Popover } from '@wordpress/components';
import { withInstanceId, withSafeTimeout, compose } from '@wordpress/compose';
import { withSelect } from '@wordpress/data';

import './autocomplete-dropdown.scss';

const stopEventPropagation = ( event ) => event.stopPropagation();

/**
 * An search field that autocompletes with a dropdown for selecting an element.
 * This is heavily based on URLInput, and keyboard handling and accessibility is directly taken from that component.
 * @see https://github.com/WordPress/gutenberg/tree/a32d813a6c4243dbf03725da1c7d961c62409f44/packages/block-editor/src/components/url-input
 */
class AutocompleteDropdown extends Component {
	constructor( { autocompleteRef } ) {
		super( ...arguments );

		this.onChange = this.onChange.bind( this );
		this.onKeyDown = this.onKeyDown.bind( this );
		this.autocompleteRef = autocompleteRef || createRef();
		this.inputRef = createRef();
		this.updateSuggestions = throttle( this.updateSuggestions.bind( this ), 200 );

		this.suggestionNodes = [];

		this.state = {
			suggestions: [],
			showSuggestions: false,
			selectedSuggestion: null,
			currentInput: '',
			loading: false,
		};
	}

	componentDidMount() {
		const { selectedItem, fetchSavedInfo } = this.props;
		if ( !! selectedItem ) {
			this.setState( { loading: true }, () => {
				fetchSavedInfo( selectedItem ).then( ( item ) => {
					this.setState( {
						loading: false,
						currentInput: item.label
					} );
				} );
			} );
		}
	}

	componentDidUpdate() {
		const { showSuggestions, selectedSuggestion } = this.state;
		if ( showSuggestions && selectedSuggestion !== null && ! this.scrollingIntoView ) {
			this.scrollingIntoView = true;
			scrollIntoView( this.suggestionNodes[ selectedSuggestion ], this.autocompleteRef.current, {
				onlyScrollIfNeeded: true,
			} );

			this.props.setTimeout( () => {
				this.scrollingIntoView = false;
			}, 100 );
		}
	}

	componentWillUnmount() {
		delete this.suggestionsRequest;
	}

	bindSuggestionNode( index ) {
		return ( ref ) => {
			this.suggestionNodes[ index ] = ref;
		};
	}

	updateSuggestions( value ) {
		const { fetchSuggestions } = this.props;
		if ( ! fetchSuggestions ) {
			return;
		}

		// Show the suggestions after typing at least 1 character.
		if ( value.length < 1 ) {
			this.setState( {
				showSuggestions: false,
				selectedSuggestion: null,
				loading: false,
			} );

			return;
		}

		this.setState( {
			showSuggestions: true,
			selectedSuggestion: null,
			loading: true,
		} );

		const request = fetchSuggestions( value );

		request.then( ( suggestions ) => {
			// A fetch Promise doesn't have an abort option. It's mimicked by
			// comparing the request reference in on the instance, which is
			// reset or deleted on subsequent requests or unmounting.
			if ( this.suggestionsRequest !== request ) {
				return;
			}

			this.setState( {
				suggestions,
				loading: false,
			} );

			if ( !! suggestions.length ) {
				this.props.debouncedSpeak( sprintf( _n(
					'%d result found, use up and down arrow keys to navigate.',
					'%d results found, use up and down arrow keys to navigate.',
					suggestions.length
				), suggestions.length ), 'assertive' );
			} else {
				this.props.debouncedSpeak( __( 'No results.' ), 'assertive' );
			}
		} ).catch( () => {
			if ( this.suggestionsRequest === request ) {
				this.setState( {
					loading: false,
				} );
			}
		} );

		this.suggestionsRequest = request;
	}

	onChange( event ) {
		const inputValue = event.target.value;
		this.setState({
			currentInput: inputValue,
		}, () => { this.updateSuggestions( inputValue ); } );
	}

	onKeyDown( event ) {
		const { showSuggestions, selectedSuggestion, suggestions, loading } = this.state;
		// If the suggestions are not shown or loading, we shouldn't handle the arrow keys
		// We shouldn't preventDefault to allow block arrow keys navigation
		if ( ! showSuggestions || ! suggestions.length || loading ) {
			// In the Windows version of Firefox the up and down arrows don't move the caret
			// within an input field like they do for Mac Firefox/Chrome/Safari. This causes
			// a form of focus trapping that is disruptive to the user experience. This disruption
			// only happens if the caret is not in the first or last position in the text input.
			// See: https://github.com/WordPress/gutenberg/issues/5693#issuecomment-436684747
			switch ( event.keyCode ) {
				// When UP is pressed, if the caret is at the start of the text, move it to the 0
				// position.
				case UP: {
					if ( 0 !== event.target.selectionStart ) {
						event.stopPropagation();
						event.preventDefault();

						// Set the input caret to position 0
						event.target.setSelectionRange( 0, 0 );
					}
					break;
				}
				// When DOWN is pressed, if the caret is not at the end of the text, move it to the
				// last position.
				case DOWN: {
					if ( this.props.value.length !== event.target.selectionStart ) {
						event.stopPropagation();
						event.preventDefault();

						// Set the input caret to the last position
						event.target.setSelectionRange( this.props.value.length, this.props.value.length );
					}
					break;
				}
			}

			return;
		}

		const suggestion = this.state.suggestions[ this.state.selectedSuggestion ];

		switch ( event.keyCode ) {
			case UP: {
				event.stopPropagation();
				event.preventDefault();
				const previousIndex = ! selectedSuggestion ? suggestions.length - 1 : selectedSuggestion - 1;
				this.setState( {
					selectedSuggestion: previousIndex,
				} );
				break;
			}
			case DOWN: {
				event.stopPropagation();
				event.preventDefault();
				const nextIndex = selectedSuggestion === null || ( selectedSuggestion === suggestions.length - 1 ) ? 0 : selectedSuggestion + 1;
				this.setState( {
					selectedSuggestion: nextIndex,
				} );
				break;
			}
			case TAB: {
				if ( this.state.selectedSuggestion !== null ) {
					this.selectLink( suggestion );
					// Announce a link has been selected when tabbing away from the input field.
					this.props.speak( __( 'Link selected.' ) );
				}
				break;
			}
			case ENTER: {
				if ( this.state.selectedSuggestion !== null ) {
					event.stopPropagation();
					this.selectLink( suggestion );
				}
				break;
			}
		}
	}

	selectLink( suggestion ) {
		this.props.onSelect( suggestion.value, suggestion );
		this.setState( {
			selectedSuggestion: null,
			showSuggestions: false,
			currentInput: suggestion.label,
		} );
	}

	handleOnClick( suggestion ) {
		this.selectLink( suggestion );
		// Move focus to the input field when a link suggestion is clicked.
		this.inputRef.current.focus();
	}

	resetSelection() {
		const originalInputValue = this.state.currentInput;
		this.selectLink( { value: '', label: originalInputValue } );
		this.updateSuggestions( originalInputValue );
	}

	render() {
		const { instanceId, className, id, selectedItem } = this.props;
		const { showSuggestions, suggestions, selectedSuggestion, loading, currentInput } = this.state;

		const suggestionsListboxId = `block-editor-autocomplete-dropdown-input-suggestions-${ instanceId }`;
		const suggestionOptionIdPrefix = `block-editor-autocomplete-dropdown-input-suggestion-${ instanceId }`;

		return (
			<div className='editor-autocomplete-dropdown-input block-editor-autocomplete-dropdown-input'>				
				<input
					id={ id }
					type="text"
					aria-label={ __( 'Type to search' ) }
					required
					value={ currentInput }
					onChange={ this.onChange }
					onInput={ stopEventPropagation }
					placeholder={ __( 'Type to search' ) }
					onKeyDown={ this.onKeyDown }
					role="combobox"
					aria-expanded={ showSuggestions }
					aria-autocomplete="list"
					aria-owns={ suggestionsListboxId }
					aria-activedescendant={ selectedSuggestion !== null ? `${ suggestionOptionIdPrefix }-${ selectedSuggestion }` : undefined }
					ref={ this.inputRef }
					disabled={ !! selectedItem }
				/>

				{ ( loading ) && <Spinner /> }

				{ !! selectedItem && (
					<div className='selected-item'>
						<a href='#' onClick={ () => this.resetSelection() }>Change</a>
					</div>
				) }

				{ showSuggestions && !! suggestions.length &&
					<Popover
						position="bottom"
						noArrow
						focusOnMount={ false }
					>
						<div
							className={ classnames(
								'editor-autocomplete-dropdown-input__suggestions',
								'block-editor-autocomplete-dropdown-input__suggestions',
								`${ className }__suggestions`
							) }
							id={ suggestionsListboxId }
							ref={ this.autocompleteRef }
							role="listbox"
						>
							{ suggestions.map( ( suggestion, index ) => (
								<button
									key={ suggestion.value }
									role="option"
									tabIndex="-1"
									id={ `${ suggestionOptionIdPrefix }-${ index }` }
									ref={ this.bindSuggestionNode( index ) }
									className={ classnames( 'editor-autocomplete-dropdown-input__suggestion block-editor-autocomplete-dropdown-input__suggestion', {
										'is-selected': index === selectedSuggestion,
									} ) }
									onClick={ () => this.handleOnClick( suggestion ) }
									aria-selected={ index === selectedSuggestion }
								>
									{ suggestion.label }
								</button>
							) ) }
						</div>
					</Popover>
				}
			</div>
		);
	}
}

export default compose(
	withSafeTimeout,
	withSpokenMessages,
	withInstanceId
)( AutocompleteDropdown );